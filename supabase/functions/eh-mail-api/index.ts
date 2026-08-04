import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAILU_API_BASE = (Deno.env.get("MAILU_API_BASE") ?? "https://mail.kmerhosting.com/api/v1").replace(/\/$/, "");
const MAILU_API_TOKEN = Deno.env.get("MAILU_API_TOKEN") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
type Json = Record<string, unknown>;
function response(body: Json, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function cleanError(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function requireUser(req: Request) {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization) throw new Error("Authentication required.");
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Invalid or expired session.");
  const { data: profile } = await admin.from("eh_profiles").select("role,status").eq("id", data.user.id).single();
  if (!profile || profile.status !== "active") throw new Error("Account is disabled.");
  return { user: data.user, isAdmin: profile.role === "admin" };
}
async function mailu(path: string, init: RequestInit = {}) {
  if (!MAILU_API_TOKEN) throw new Error("MAILU_API_TOKEN is not configured on the server.");
  const result = await fetch(`${MAILU_API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${MAILU_API_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await result.text(); let payload: unknown = null; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!result.ok) { const message = typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : `Mailu returned HTTP ${result.status}`; const error = new Error(message) as Error & { status?: number }; error.status = result.status; throw error; }
  return payload as Record<string, unknown>;
}
async function ownedService(serviceId: string, userId: string, isAdmin: boolean) { let query = admin.from("eh_services").select("*").eq("id", serviceId); if (!isAdmin) query = query.eq("user_id", userId); const { data, error } = await query.single(); if (error || !data) throw new Error("Email hosting service not found."); return data; }
function dnsRows(serviceId: string, domain: string, details: Record<string, unknown>) {
  const rows: Array<Record<string, unknown>> = [];
  const add = (recordType: string, hostname: string, value: unknown, priority: number | null = null) => { if (value == null || value === "") return; if (Array.isArray(value)) { for (const item of value) add(recordType, hostname, item, priority); return; } for (const item of String(value).split("\n").map((v) => v.trim()).filter(Boolean)) rows.push({ service_id: serviceId, record_type: recordType, hostname, value: item, priority, status: "pending" }); };
  add("MX", domain, details.dns_mx, 10); add("TXT", domain, details.dns_spf); add("TXT", domain, details.dns_dmarc); add("TXT", domain, details.dns_dmarc_report); add("TXT", domain, details.dns_dkim); add("TLSA", `_25._tcp.${domain}`, details.dns_tlsa); add("AUTOCONFIG", domain, details.dns_autoconfig); return rows;
}
async function syncDns(service: Record<string, unknown>) { const domain = String(service.domain_name); const details = await mailu(`/domain/${encodeURIComponent(domain)}`); const rows = dnsRows(String(service.id), domain, details); await admin.from("eh_dns_records").delete().eq("service_id", service.id); if (rows.length) { const { error } = await admin.from("eh_dns_records").insert(rows); if (error) throw error; } return rows; }
async function provisionService(service: Record<string, unknown>) {
  const domain = String(service.domain_name); const body = { name: domain, comment: `KmerHosting Email service ${service.id}`, max_users: service.mailbox_limit ?? -1, max_aliases: -1, max_quota_bytes: Number(service.storage_bytes_per_mailbox), signup_enabled: false };
  try { await mailu("/domain", { method: "POST", body: JSON.stringify(body) }); } catch (error) { if ((error as Error & { status?: number }).status !== 409) throw error; }
  try { await mailu(`/domain/${encodeURIComponent(domain)}/dkim`, { method: "POST", body: "{}" }); } catch (error) { if ((error as Error & { status?: number }).status !== 409) console.warn("DKIM generation warning", cleanError(error)); }
  const records = await syncDns(service); const { error } = await admin.from("eh_services").update({ status: "active", mailu_domain_created: true, last_provisioned_at: new Date().toISOString() }).eq("id", service.id); if (error) throw error;
  await admin.from("eh_provisioning_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null }).eq("service_id", service.id).eq("job_type", "create_domain").in("status", ["pending", "failed", "processing"]); return { records };
}
async function setDomainUsersEnabled(domain: string, enabled: boolean) { const users = await mailu(`/domain/${encodeURIComponent(domain)}/users`) as unknown; const list = Array.isArray(users) ? users : []; for (const item of list) { const email = String((item as Record<string, unknown>).email ?? ""); if (email) await mailu(`/user/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ enabled }) }); } const emails = list.map((item) => String((item as Record<string, unknown>).email ?? "")).filter(Boolean); if (emails.length) await admin.from("eh_mailboxes").update({ enabled }).in("email", emails); return list.length; }
async function processJobs(limit = 20) {
  const { data: jobs, error } = await admin.from("eh_provisioning_jobs").select("*").in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit); if (error) throw error; let processed = 0;
  for (const job of jobs ?? []) { await admin.from("eh_provisioning_jobs").update({ status: "processing", attempts: job.attempts + 1, locked_at: new Date().toISOString() }).eq("id", job.id); try { if (!job.service_id) throw new Error("Job has no service ID."); const { data: service, error: serviceError } = await admin.from("eh_services").select("*").eq("id", job.service_id).single(); if (serviceError || !service) throw new Error("Service no longer exists."); if (job.job_type === "create_domain") await provisionService(service); else if (job.job_type === "suspend_domain") await setDomainUsersEnabled(service.domain_name, false); else if (job.job_type === "resume_domain") await setDomainUsersEnabled(service.domain_name, true); else if (job.job_type === "sync_dns") await syncDns(service); else throw new Error(`Unsupported provisioning job: ${job.job_type}`); await admin.from("eh_provisioning_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null }).eq("id", job.id); processed += 1; } catch (jobError) { const attempts = job.attempts + 1; const terminal = attempts >= job.max_attempts; await admin.from("eh_provisioning_jobs").update({ status: terminal ? "cancelled" : "failed", last_error: cleanError(jobError), next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000).toISOString() }).eq("id", job.id); } }
  return processed;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders }); if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  try { const { user, isAdmin } = await requireUser(req); const body = await req.json() as Record<string, unknown>; const action = String(body.action ?? "");
    if (action === "provision_service") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); return response({ ok: true, ...await provisionService(service) }); }
    if (action === "sync_dns") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); return response({ ok: true, records: await syncDns(service) }); }
    if (action === "create_mailbox") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); if (!["active", "provisioning"].includes(String(service.status))) throw new Error("This service cannot create mailboxes in its current state."); if (!service.mailu_domain_created) throw new Error("The domain is not provisioned in Mailu yet."); const localPart = String(body.localPart ?? "").trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(localPart)) throw new Error("Invalid mailbox address."); const password = String(body.password ?? ""); if (password.length < 10) throw new Error("The temporary password must contain at least 10 characters."); const email = `${localPart}@${service.domain_name}`; const { count } = await admin.from("eh_mailboxes").select("id", { count: "exact", head: true }).eq("service_id", service.id); if (service.mailbox_limit != null && Number(count ?? 0) >= Number(service.mailbox_limit)) throw new Error("The mailbox limit for this plan has been reached."); await mailu("/user", { method: "POST", body: JSON.stringify({ email, raw_password: password, quota_bytes: Number(service.storage_bytes_per_mailbox), displayed_name: String(body.displayName ?? "").trim(), enabled: true, enable_imap: true, enable_pop: false, spam_enabled: true, change_pw_next_login: true }) }); const { data: mailbox, error } = await admin.from("eh_mailboxes").insert({ service_id: service.id, user_id: service.user_id, email, local_part: localPart, display_name: String(body.displayName ?? "").trim() || null, quota_bytes: service.storage_bytes_per_mailbox, mailu_synced: true, last_synced_at: new Date().toISOString() }).select().single(); if (error) { try { await mailu(`/user/${encodeURIComponent(email)}`, { method: "DELETE" }); } catch { } throw error; } return response({ ok: true, mailbox }, 201); }
    if (action === "delete_mailbox") { let query = admin.from("eh_mailboxes").select("*, eh_services!inner(user_id)").eq("id", String(body.mailboxId ?? "")); if (!isAdmin) query = query.eq("eh_services.user_id", user.id); const { data: mailbox, error } = await query.single(); if (error || !mailbox) throw new Error("Mailbox not found."); await mailu(`/user/${encodeURIComponent(mailbox.email)}`, { method: "DELETE" }); const deletion = await admin.from("eh_mailboxes").delete().eq("id", mailbox.id); if (deletion.error) throw deletion.error; return response({ ok: true }); }
    if (action === "create_alias") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); const localPart = String(body.localPart ?? "").trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(localPart)) throw new Error("Invalid alias address."); const destinations = Array.isArray(body.destinations) ? body.destinations.map(String) : []; if (!destinations.length) throw new Error("At least one destination is required."); const email = `${localPart}@${service.domain_name}`; await mailu("/alias", { method: "POST", body: JSON.stringify({ email, destination: destinations, wildcard: Boolean(body.wildcard) }) }); const { data: alias, error } = await admin.from("eh_aliases").insert({ service_id: service.id, user_id: service.user_id, email, destinations, wildcard: Boolean(body.wildcard), mailu_synced: true }).select().single(); if (error) throw error; return response({ ok: true, alias }, 201); }
    if (action === "delete_alias") { let query = admin.from("eh_aliases").select("*").eq("id", String(body.aliasId ?? "")); if (!isAdmin) query = query.eq("user_id", user.id); const { data: alias, error } = await query.single(); if (error || !alias) throw new Error("Alias not found."); await mailu(`/alias/${encodeURIComponent(alias.email)}`, { method: "DELETE" }); await admin.from("eh_aliases").delete().eq("id", alias.id); return response({ ok: true }); }
    if (action === "run_automation") { if (!isAdmin) throw new Error("Administrator access required."); const [{ data: reminders }, { data: renewals }, { data: suspensions }] = await Promise.all([admin.rpc("eh_queue_renewal_reminders"), admin.rpc("eh_process_due_renewals"), admin.rpc("eh_suspend_expired_services")]); return response({ ok: true, reminders, renewals, suspensions, processed: await processJobs(50) }); }
    return response({ ok: false, error: "Unknown action." }, 400);
  } catch (error) { console.error(error); const message = cleanError(error); const status = message.includes("Authentication") || message.includes("session") ? 401 : message.includes("Administrator") ? 403 : 400; return response({ ok: false, error: message }, status); }
});
