import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-eh-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAILU_API_BASE = (Deno.env.get("MAILU_API_BASE") ?? "https://mail.kmerhosting.com/api/v1").replace(/\/$/, "");
const MAILU_API_TOKEN = Deno.env.get("MAILU_API_TOKEN") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
type Json = Record<string, unknown>;
type AppUser = { id: string; email: string; full_name: string; company_name: string | null; role: string; status: string };

function response(body: Json, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...headers, "Content-Type": "application/json" } });
}
function cleanError(error: unknown) { if (error instanceof Error) return error.message; if (typeof error === "object" && error !== null) { const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }; return [value.message, value.details, value.hint, value.code].filter(Boolean).map(String).join(" | ") || JSON.stringify(error); } return String(error); }
function requestToken(req: Request) {
  const explicit = req.headers.get("x-eh-session")?.trim();
  if (explicit) return explicit;
  const authorization = req.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  const cookie = req.headers.get("Cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("eh_session="))?.slice("eh_session=".length) ?? "";
}
function cookie(token: string, maxAge: number) {
  return `eh_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hmac(value: string) {
  const { data, error } = await admin.rpc("eh_get_email_otp_secret");
  if (error || typeof data !== "string" || !data) throw new Error("Email verification is not configured on the server.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(data), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function mailtrapToken() {
  const { data, error } = await admin.rpc("eh_get_mailtrap_api_token");
  if (error || typeof data !== "string" || !data || data === "not-configured") throw new Error("Mailtrap is not configured on the server.");
  return data;
}
async function configValue(key: string, fallback: string) {
  const { data } = await admin.from("eh_config").select("value").eq("key", key).maybeSingle();
  return String(data?.value || fallback);
}
function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character); }
function maskedEmail(email: string) { const [local, domain] = email.split("@"); return local && domain ? `${local.slice(0, 2)}***@${domain}` : email; }
function otpCode() { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return String(100000 + (bytes[0] % 900000)); }
async function sendMail(input: { to: string; subject: string; html: string; category: string }) {
  const result = await fetch(await configValue("mailtrap_api_url", "https://send.api.mailtrap.io/api/send"), {
    method: "POST",
    headers: { Authorization: `Bearer ${await mailtrapToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: { email: await configValue("mailtrap_from_email", "support@kmerhosting.com"), name: await configValue("mailtrap_from_name", "KmerHosting") },
      to: [{ email: input.to }],
      subject: `${await configValue("email_subject_prefix", "[KmerHosting]")} ${input.subject}`,
      html: input.html,
      category: input.category,
    }),
  });
  if (!result.ok) throw new Error(`Mailtrap returned HTTP ${result.status}`);
  return await result.json().catch(() => ({}));
}
async function createSession(userId: string, req: Request) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from("eh_sessions").insert({ user_id: userId, token_hash: tokenHash, expires_at: expires, ip_address: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null, user_agent: req.headers.get("user-agent") || null });
  if (error) throw error;
  return { token, expires };
}
async function currentUser(req: Request): Promise<{ user: AppUser; sessionHash: string }> {
  const token = requestToken(req);
  if (!token) throw new Error("Authentication required.");
  const tokenHash = await sha256(token);
  const { data: session, error: sessionError } = await admin.from("eh_sessions").select("user_id,expires_at").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (sessionError || !session) throw new Error("Invalid or expired session.");
  const { data: user, error } = await admin.from("eh_users").select("id,email,full_name,company_name,role,status").eq("id", session.user_id).maybeSingle();
  if (error || !user || user.status !== "active") throw new Error("Account is disabled.");
  void admin.from("eh_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash);
  return { user: user as AppUser, sessionHash: tokenHash };
}
function authResponse(user: AppUser, token: string, extra: Json = {}) { return response({ ok: true, user, ...extra }, 200, { "Set-Cookie": cookie(token, 30 * 24 * 60 * 60) }); }
function otpHtml(code: string, purpose: string) { const action = purpose === "registration" ? "verify your Email Hosting account" : "reset your Email Hosting password"; return `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;background:#f7f7f7;padding:24px"><main style="max-width:560px;margin:auto;background:#fff;padding:32px;border-top:4px solid #0e8420"><h1>KmerHosting Email Hosting</h1><p>Use this code to ${action}:</p><p style="font:700 32px monospace;letter-spacing:8px;text-align:center;background:#f2f2f2;padding:18px">${escapeHtml(code)}</p><p>This code expires in 10 minutes and can be used only once. If you did not request it, ignore this email.</p><p>Support: support@kmerhosting.com</p></main></body></html>`; }
async function issueOtp(userId: string | null, email: string, purpose: "registration" | "password_reset", extras: Record<string, unknown> = {}) {
  const code = otpCode();
  const id = crypto.randomUUID();
  const { error } = await admin.from("eh_otp_challenges").insert({ id, purpose, user_id: userId, email, code_hash: await hmac(`${id}:${code}`), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), ...extras });
  if (error) throw error;
  await sendMail({ to: email, subject: purpose === "registration" ? "Verify your Email Hosting account" : "Reset your Email Hosting password", html: otpHtml(code, purpose), category: `email-hosting-${purpose}` });
  return { challengeId: id, maskedEmail: maskedEmail(email), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
}
async function ownedService(serviceId: string, userId: string, isAdmin: boolean) { let query = admin.from("eh_services").select("*").eq("id", serviceId); if (!isAdmin) query = query.eq("user_id", userId); const { data, error } = await query.single(); if (error || !data) throw new Error("Email hosting service not found."); return data; }
async function mailuToken() { if (MAILU_API_TOKEN) return MAILU_API_TOKEN; const { data, error } = await admin.rpc("eh_get_mailu_api_token"); if (error || typeof data !== "string" || !data) throw new Error("The mail service API token is not configured on the server."); return data; }
async function mailu(path: string, init: RequestInit = {}) { const result = await fetch(`${MAILU_API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${await mailuToken()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } }); const text = await result.text(); let payload: unknown = null; try { payload = text ? JSON.parse(text) : null; } catch { payload = text; } if (!result.ok) { const error = new Error(typeof payload === "object" && payload && "message" in payload ? String((payload as { message: unknown }).message) : `The mail service returned HTTP ${result.status}`) as Error & { status?: number }; error.status = result.status; throw error; } return payload as Record<string, unknown>; }
function dnsRows(serviceId: string, domain: string, details: Record<string, unknown>) { const rows: Array<Record<string, unknown>> = []; const add = (recordType: string, hostname: string, value: unknown, priority: number | null = null) => { if (value == null || value === "") return; if (Array.isArray(value)) { for (const item of value) add(recordType, hostname, item, priority); return; } for (const item of String(value).split("\n").map((v) => v.trim()).filter(Boolean)) rows.push({ service_id: serviceId, record_type: recordType, hostname, value: item, priority, status: "pending" }); }; add("MX", domain, details.dns_mx, 10); add("TXT", domain, details.dns_spf); add("TXT", domain, details.dns_dmarc); add("TXT", domain, details.dns_dmarc_report); add("TXT", domain, details.dns_dkim); add("TLSA", `_25._tcp.${domain}`, details.dns_tlsa); add("AUTOCONFIG", domain, details.dns_autoconfig); return rows; }
function normalizeDnsValue(value: unknown) { return String(value ?? "").replace(/"\s+"/g, "").replaceAll('"', "").replace(/\.$/, "").replace(/\s+/g, " ").trim().toLowerCase(); }
function parseDnsExpectation(record: Record<string, unknown>) {
  const line = String(record.value ?? "").trim();
  const match = line.match(/^(\S+)\s+\d+\s+IN\s+(\S+)\s+(.+)$/i);
  return match ? { name: match[1], type: match[2].toUpperCase(), data: match[3] } : { name: String(record.hostname), type: String(record.record_type), data: line };
}
async function verifyDnsRecords(serviceId: string) {
  const { data: records, error } = await admin.from("eh_dns_records").select("*").eq("service_id", serviceId).order("record_type");
  if (error) throw error;
  const checkedAt = new Date().toISOString();
  const checked = await Promise.all((records ?? []).map(async (record) => {
    const expected = parseDnsExpectation(record as Record<string, unknown>);
    let status = "pending";
    try {
      const lookup = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(expected.name)}&type=${encodeURIComponent(expected.type)}`, { headers: { Accept: "application/dns-json" } });
      if (!lookup.ok) throw new Error(`DNS lookup returned HTTP ${lookup.status}`);
      const payload = await lookup.json() as { Answer?: Array<{ data?: unknown }> };
      const answers = Array.isArray(payload.Answer) ? payload.Answer : [];
      status = answers.some((answer) => normalizeDnsValue(answer.data) === normalizeDnsValue(expected.data)) ? "verified" : answers.length ? "failed" : "pending";
    } catch (lookupError) {
      console.warn(`DNS lookup failed for ${expected.name}`, cleanError(lookupError));
    }
    const { error: updateError } = await admin.from("eh_dns_records").update({ status, last_checked_at: checkedAt }).eq("id", record.id).eq("service_id", serviceId);
    if (updateError) throw updateError;
    return { ...record, status, last_checked_at: checkedAt };
  }));
  const verifiedCount = checked.filter((record) => record.status === "verified").length;
  return { records: checked, summary: { verifiedCount, totalCount: checked.length, allVerified: checked.length > 0 && verifiedCount === checked.length } };
}
function csvValue(value: unknown) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function dnsCsv(records: Array<Record<string, unknown>>) {
  const rows = [["Record type", "Hostname", "Value", "Priority", "Status"], ...records.map((record) => [record.record_type, record.hostname, record.value, record.priority ?? "", record.status])];
  return `\uFEFF${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}
function dnsCsvFilename(domain: string) { return `${domain.replace(/[^a-z0-9.-]+/gi, "-")}-dns-records.csv`; }
async function syncDns(service: Record<string, unknown>) { const domain = String(service.domain_name); const details = await mailu(`/domain/${encodeURIComponent(domain)}`); const rows = dnsRows(String(service.id), domain, details); await admin.from("eh_dns_records").delete().eq("service_id", service.id); if (rows.length) { const { error } = await admin.from("eh_dns_records").insert(rows); if (error) throw error; } return rows; }
async function provisionService(service: Record<string, unknown>) { const domain = String(service.domain_name); try { await mailu("/domain", { method: "POST", body: JSON.stringify({ name: domain, comment: `KmerHosting Email service ${service.id}`, max_users: service.mailbox_limit ?? -1, max_aliases: -1, max_quota_bytes: Number(service.storage_bytes_per_mailbox), signup_enabled: false }) }); } catch (error) { if ((error as Error & { status?: number }).status !== 409) throw error; } try { await mailu(`/domain/${encodeURIComponent(domain)}/dkim`, { method: "POST", body: "{}" }); } catch (error) { if ((error as Error & { status?: number }).status !== 409) console.warn("DKIM generation warning", cleanError(error)); } const records = await syncDns(service); const { error } = await admin.from("eh_services").update({ status: "active", mailu_domain_created: true, last_provisioned_at: new Date().toISOString() }).eq("id", service.id); if (error) throw error; await admin.from("eh_provisioning_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null }).eq("service_id", service.id).eq("job_type", "create_domain").in("status", ["pending", "failed", "processing"]); return { records }; }
async function setDomainUsersEnabled(domain: string, enabled: boolean) { const payload = await mailu(`/domain/${encodeURIComponent(domain)}/users`) as unknown; const list = Array.isArray(payload) ? payload : []; for (const item of list) { const email = String((item as Record<string, unknown>).email ?? ""); if (email) await mailu(`/user/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ enabled }) }); } const emails = list.map((item) => String((item as Record<string, unknown>).email ?? "")).filter(Boolean); if (emails.length) await admin.from("eh_mailboxes").update({ enabled }).in("email", emails); return list.length; }
async function processJobs(limit = 20) { const { data: jobs, error } = await admin.from("eh_provisioning_jobs").select("*").in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit); if (error) throw error; let processed = 0; for (const job of jobs ?? []) { await admin.from("eh_provisioning_jobs").update({ status: "processing", attempts: job.attempts + 1, locked_at: new Date().toISOString() }).eq("id", job.id); try { if (!job.service_id) throw new Error("Job has no service ID."); const { data: service } = await admin.from("eh_services").select("*").eq("id", job.service_id).single(); if (!service) throw new Error("Service no longer exists."); if (job.job_type === "create_domain") await provisionService(service); else if (job.job_type === "suspend_domain") await setDomainUsersEnabled(service.domain_name, false); else if (job.job_type === "resume_domain") await setDomainUsersEnabled(service.domain_name, true); else if (job.job_type === "sync_dns") await syncDns(service); else throw new Error(`Unsupported provisioning job: ${job.job_type}`); await admin.from("eh_provisioning_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error: null }).eq("id", job.id); processed += 1; } catch (error) { const attempts = job.attempts + 1; await admin.from("eh_provisioning_jobs").update({ status: attempts >= job.max_attempts ? "cancelled" : "failed", last_error: cleanError(error), next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000).toISOString() }).eq("id", job.id); } } return processed; }
async function dashboard(userId: string) { const [wallet, services, invoices, notifications, mailboxes, plans] = await Promise.all([admin.from("eh_wallets").select("*").eq("user_id", userId).maybeSingle(), admin.from("eh_services").select("*").eq("user_id", userId).order("created_at", { ascending: false }), admin.from("eh_invoices").select("*").eq("user_id", userId).order("issued_at", { ascending: false }).limit(10), admin.from("eh_notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20), admin.from("eh_mailboxes").select("*").eq("user_id", userId).order("created_at", { ascending: false }), admin.from("eh_plans").select("id,name,monthly_price")]); const planMap = Object.fromEntries((plans.data ?? []).map((plan) => [String(plan.id), plan])); return { wallet: wallet.data, services: (services.data ?? []).map((service) => ({ ...service, eh_plans: planMap[String(service.plan_id)] ?? null })), invoices: invoices.data ?? [], notifications: notifications.data ?? [], mailboxes: mailboxes.data ?? [] }; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "auth_register") { const email = String(body.email ?? "").trim().toLowerCase(); const password = String(body.password ?? ""); const fullName = String(body.fullName ?? "").trim(); const { data, error } = await admin.rpc("eh_auth_create_user", { p_email: email, p_password: password, p_full_name: fullName, p_company_name: String(body.companyName ?? "").trim() || null }); if (error) throw new Error(error.message); const user = data as AppUser; return response({ ok: true, verificationRequired: true, user, ...(await issueOtp(String(user.id), email, "registration")) }, 202); }
    if (action === "auth_verify_registration") { const challengeId = String(body.challengeId ?? ""); const code = String(body.code ?? ""); const { data: challenge, error } = await admin.from("eh_otp_challenges").select("*").eq("id", challengeId).eq("purpose", "registration").is("consumed_at", null).maybeSingle(); if (error || !challenge || new Date(challenge.expires_at).getTime() <= Date.now()) throw new Error("The verification code is invalid or expired."); if (challenge.attempts >= challenge.max_attempts) throw new Error("Too many incorrect attempts. Request a new code."); if ((await hmac(`${challenge.id}:${code}`)) !== challenge.code_hash) { await admin.from("eh_otp_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challenge.id); throw new Error("The verification code is incorrect."); } const { data: user, error: verifyError } = await admin.rpc("eh_auth_verify_email", { p_user_id: challenge.user_id }); if (verifyError) throw new Error(verifyError.message); await admin.from("eh_otp_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id); const session = await createSession(String(challenge.user_id), req); return authResponse(user as AppUser, session.token); }
    if (action === "auth_login") { const { data, error } = await admin.rpc("eh_auth_login", { p_email: String(body.email ?? "").trim().toLowerCase(), p_password: String(body.password ?? "") }); if (error) throw new Error(error.message); const session = await createSession(String((data as AppUser).id), req); return authResponse(data as AppUser, session.token); }
    if (action === "auth_me") { const { user } = await currentUser(req); return response({ ok: true, user }); }
    if (action === "auth_logout") { const token = requestToken(req); if (token) await admin.from("eh_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", await sha256(token)); return response({ ok: true }, 200, { "Set-Cookie": cookie("", 0) }); }
    if (action === "auth_password_reset_request") { const email = String(body.email ?? "").trim().toLowerCase(); const { data: user } = await admin.from("eh_users").select("id").eq("email", email).eq("status", "active").maybeSingle(); const challenge = user ? await issueOtp(user.id, email, "password_reset") : null; return response({ ok: true, message: "If the account exists, a verification code has been sent.", ...(challenge ?? {}) }, 202); }
    if (action === "auth_password_reset") { const challengeId = String(body.challengeId ?? ""); const { data: challenge } = await admin.from("eh_otp_challenges").select("*").eq("id", challengeId).eq("purpose", "password_reset").is("consumed_at", null).maybeSingle(); if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= challenge.max_attempts) throw new Error("The password reset request is invalid or expired."); if ((await hmac(`${challenge.id}:${String(body.code ?? "")}`)) !== challenge.code_hash) { await admin.from("eh_otp_challenges").update({ attempts: challenge.attempts + 1 }).eq("id", challenge.id); throw new Error("The verification code is incorrect."); } const { data: changed, error } = await admin.rpc("eh_auth_set_password", { p_user_id: challenge.user_id, p_password: String(body.password ?? "") }); if (error || !changed) throw new Error(error?.message || "Unable to update the password."); await admin.from("eh_otp_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challenge.id); await admin.from("eh_sessions").update({ revoked_at: new Date().toISOString() }).eq("user_id", challenge.user_id); return response({ ok: true }); }

    const { user, sessionHash } = await currentUser(req);
    const isAdmin = user.role === "admin";
    if (action === "dashboard") return response({ ok: true, ...(await dashboard(user.id)) });
    if (action === "service_dns") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); const { data: records, error } = await admin.from("eh_dns_records").select("*").eq("service_id", service.id).order("record_type"); if (error) throw error; return response({ ok: true, records: records ?? [] }); }
    if (action === "verify_dns") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); return response({ ok: true, ...(await verifyDnsRecords(String(service.id))) }); }
    if (action === "send_dns_help") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); const { data: records, error } = await admin.from("eh_dns_records").select("record_type,hostname,value,priority,status").eq("service_id", service.id).order("record_type"); if (error) throw error; if (!records?.length) throw new Error("No DNS records are available for this service yet."); const supportEmail = await configValue("support_email", "support@kmerhosting.com"); const csv = dnsCsv(records as Array<Record<string, unknown>>); const filename = dnsCsvFilename(String(service.domain_name)); const { data: queued, error: queueError } = await admin.from("eh_email_outbox").insert({ user_id: user.id, recipient: supportEmail, template_key: "dns_support", subject: `DNS setup help · ${service.domain_name}`, payload: { domainName: service.domain_name, replyTo: user.email, attachmentFilename: filename, csv, message: "A customer requested free DNS setup assistance. The DNS records are attached as a CSV file." } }).select("id").single(); if (queueError) throw queueError; return response({ ok: true, queued: true, requestId: queued.id, recipient: supportEmail }, 202); }
    if (action === "wallet_transactions") { const { data, error } = await admin.from("eh_wallet_transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30); if (error) throw error; return response({ ok: true, transactions: data ?? [] }); }
    if (action === "mark_notification_read") { const { error } = await admin.from("eh_notifications").update({ read_at: new Date().toISOString() }).eq("id", String(body.id ?? "")).eq("user_id", user.id); if (error) throw error; return response({ ok: true }); }
    if (action === "update_profile") { const fullName = String(body.fullName ?? "").trim(); const companyName = String(body.companyName ?? "").trim() || null; const { error: userError } = await admin.from("eh_users").update({ full_name: fullName, company_name: companyName }).eq("id", user.id); if (userError) throw userError; const { error } = await admin.from("eh_profiles").update({ full_name: fullName, company_name: companyName }).eq("id", user.id); if (error) throw error; return response({ ok: true, user: { ...user, full_name: fullName, company_name: companyName } }); }
    if (action === "purchase_service") { const { data, error } = await admin.rpc("eh_purchase_service_for_user", { p_user: user.id, p_plan_id: String(body.planId ?? ""), p_term_months: Number(body.termMonths), p_domain_name: String(body.domainName ?? "") }); if (error) throw new Error(error.message); return response({ ok: true, ...(data as Json) }); }
    if (action === "admin_stats") { if (!isAdmin) throw new Error("Administrator access required."); const [users, services, jobs] = await Promise.all([admin.from("eh_users").select("id", { count: "exact", head: true }), admin.from("eh_services").select("id", { count: "exact", head: true }), admin.from("eh_provisioning_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"])]); return response({ ok: true, stats: { users: users.count ?? 0, services: services.count ?? 0, jobs: jobs.count ?? 0 } }); }
    if (action === "admin_credit") { if (!isAdmin) throw new Error("Administrator access required."); const { data, error } = await admin.rpc("eh_admin_credit_wallet_for_user", { p_admin: user.id, p_customer_email: String(body.email ?? ""), p_amount: Number(body.amount), p_reason: String(body.reason ?? ""), p_idempotency_key: String(body.idempotencyKey ?? crypto.randomUUID()) }); if (error) throw new Error(error.message); return response({ ok: true, ...(data as Json) }); }
    if (action === "provision_service") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); return response({ ok: true, ...await provisionService(service) }); }
    if (action === "sync_dns") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); return response({ ok: true, records: await syncDns(service) }); }
    if (action === "create_mailbox") { const service = await ownedService(String(body.serviceId ?? ""), user.id, isAdmin); if (!["active", "provisioning"].includes(String(service.status))) throw new Error("This service cannot create mailboxes in its current state."); if (!service.mailu_domain_created) throw new Error("The domain is not provisioned in Mailu yet."); const localPart = String(body.localPart ?? "").trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(localPart)) throw new Error("Invalid mailbox address."); const password = String(body.password ?? ""); if (password.length < 10) throw new Error("The temporary password must contain at least 10 characters."); const email = `${localPart}@${service.domain_name}`; const { count } = await admin.from("eh_mailboxes").select("id", { count: "exact", head: true }).eq("service_id", service.id); if (service.mailbox_limit != null && Number(count ?? 0) >= Number(service.mailbox_limit)) throw new Error("The mailbox limit for this plan has been reached."); await mailu("/user", { method: "POST", body: JSON.stringify({ email, raw_password: password, quota_bytes: Number(service.storage_bytes_per_mailbox), displayed_name: String(body.displayName ?? "").trim(), enabled: true, enable_imap: true, enable_pop: false, spam_enabled: true, change_pw_next_login: true }) }); const { data: mailbox, error } = await admin.from("eh_mailboxes").insert({ service_id: service.id, user_id: service.user_id, email, local_part: localPart, display_name: String(body.displayName ?? "").trim() || null, quota_bytes: service.storage_bytes_per_mailbox, mailu_synced: true, last_synced_at: new Date().toISOString() }).select().single(); if (error) { try { await mailu(`/user/${encodeURIComponent(email)}`, { method: "DELETE" }); } catch { } throw error; } return response({ ok: true, mailbox }, 201); }
    if (action === "delete_mailbox") { let query = admin.from("eh_mailboxes").select("*, eh_services!inner(user_id)").eq("id", String(body.mailboxId ?? "")); if (!isAdmin) query = query.eq("eh_services.user_id", user.id); const { data: mailbox, error } = await query.single(); if (error || !mailbox) throw new Error("Mailbox not found."); await mailu(`/user/${encodeURIComponent(mailbox.email)}`, { method: "DELETE" }); const deletion = await admin.from("eh_mailboxes").delete().eq("id", mailbox.id); if (deletion.error) throw deletion.error; return response({ ok: true }); }
    if (action === "run_automation") { if (!isAdmin) throw new Error("Administrator access required."); const [{ data: reminders }, { data: renewals }, { data: suspensions }] = await Promise.all([admin.rpc("eh_queue_renewal_reminders"), admin.rpc("eh_process_due_renewals"), admin.rpc("eh_suspend_expired_services")]); return response({ ok: true, reminders, renewals, suspensions, processed: await processJobs(50) }); }
    if (action === "test_email") { if (!isAdmin) throw new Error("Administrator access required."); await sendMail({ to: user.email, subject: "Email Hosting delivery test", category: "email-hosting-test", html: "<h1>Email Hosting delivery test</h1><p>Mailtrap transactional delivery is configured correctly.</p>" }); return response({ ok: true, deliveredTo: user.email }); }
    return response({ ok: false, error: "Unknown action." }, 400);
  } catch (error) { console.error(error); const message = cleanError(error); const status = message.includes("Authentication") || message.includes("session") || message.includes("password") && message.includes("Invalid") ? 401 : message.includes("Administrator") ? 403 : 400; return response({ ok: false, error: message }, status); }
});
