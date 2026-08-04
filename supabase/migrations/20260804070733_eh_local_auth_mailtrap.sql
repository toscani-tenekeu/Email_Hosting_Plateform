-- Replace Supabase Auth as the platform identity source with eh_users.
-- Existing eh_* data is preserved; the old eh_profiles rows remain as the
-- product profile/foreign-key compatibility layer during this transition.

create table if not exists public.eh_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  full_name text not null default '',
  company_name text,
  role public.eh_user_role not null default 'customer',
  status public.eh_account_status not null default 'active',
  email_verified_at timestamptz,
  last_login_at timestamptz,
  session_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eh_users_email_unique on public.eh_users (lower(email));

create table if not exists public.eh_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.eh_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists eh_sessions_user_expires_idx on public.eh_sessions(user_id, expires_at desc);

create table if not exists public.eh_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('registration','password_reset')),
  user_id uuid references public.eh_users(id) on delete cascade,
  email text not null,
  password_hash text,
  full_name text,
  company_name text,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eh_otp_challenges_email_idx on public.eh_otp_challenges(lower(email), purpose, created_at desc);

-- Remove the product dependency on auth.users without modifying that schema.
alter table public.eh_profiles drop constraint if exists eh_profiles_id_fkey;
drop trigger if exists eh_on_auth_user_created on auth.users;
drop function if exists public.eh_handle_new_auth_user();

-- Import existing product profiles, including the configured administrator.
insert into public.eh_users(id,email,password_hash,full_name,company_name,role,status,email_verified_at)
select p.id, p.email, crypt(gen_random_uuid()::text, gen_salt('bf')), p.full_name,
       p.company_name, p.role, p.status, now()
from public.eh_profiles p
on conflict (id) do update set
  email=excluded.email,
  full_name=excluded.full_name,
  company_name=excluded.company_name,
  role=excluded.role,
  status=excluded.status,
  updated_at=now();

insert into public.eh_wallets(user_id)
select id from public.eh_users
on conflict (user_id) do nothing;

drop trigger if exists eh_users_set_updated_at on public.eh_users;
create trigger eh_users_set_updated_at before update on public.eh_users
for each row execute function public.eh_set_updated_at();

-- Server-side Mailtrap configuration. The API token is only stored in Vault.
insert into public.eh_config(key,value) values
  ('mailtrap_api_url','https://send.api.mailtrap.io/api/send'),
  ('mailtrap_from_email','support@kmerhosting.com'),
  ('mailtrap_from_name','KmerHosting'),
  ('email_subject_prefix','[KmerHosting]')
on conflict (key) do update set value=excluded.value, updated_at=now();

do $$
begin
  if not exists(select 1 from vault.secrets where name='eh_mailtrap_api_token') then
    perform vault.create_secret('not-configured','eh_mailtrap_api_token','Mailtrap transactional API token for Email Hosting');
  end if;
  if not exists(select 1 from vault.secrets where name='eh_email_otp_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'eh_email_otp_secret','Email Hosting OTP HMAC secret');
  end if;
end $$;

create or replace function public.eh_get_mailtrap_api_token() returns text
language sql security definer set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name='eh_mailtrap_api_token' limit 1;
$$;
revoke all on function public.eh_get_mailtrap_api_token() from public,anon,authenticated;
grant execute on function public.eh_get_mailtrap_api_token() to service_role;

create or replace function public.eh_get_email_otp_secret() returns text
language sql security definer set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name='eh_email_otp_secret' limit 1;
$$;
revoke all on function public.eh_get_email_otp_secret() from public,anon,authenticated;
grant execute on function public.eh_get_email_otp_secret() to service_role;

create or replace function public.eh_auth_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_company_name text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_user public.eh_users;
begin
  if lower(trim(coalesce(p_email,''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'A valid email address is required'; end if;
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password must contain at least 8 characters'; end if;
  if exists(select 1 from public.eh_users where lower(email)=lower(trim(p_email))) then raise exception 'An account already exists for this email'; end if;
  insert into public.eh_users(email,password_hash,full_name,company_name,email_verified_at)
  values(lower(trim(p_email)),crypt(p_password,gen_salt('bf')),trim(coalesce(p_full_name,'')),nullif(trim(coalesce(p_company_name,'')),''),null)
  returning * into v_user;
  insert into public.eh_profiles(id,email,full_name,company_name,role,status)
  values(v_user.id,v_user.email,v_user.full_name,v_user.company_name,v_user.role,v_user.status)
  on conflict(id) do update set email=excluded.email,full_name=excluded.full_name,company_name=excluded.company_name;
  insert into public.eh_wallets(user_id) values(v_user.id) on conflict(user_id) do nothing;
  return jsonb_build_object('id',v_user.id,'email',v_user.email,'full_name',v_user.full_name,'role',v_user.role,'status',v_user.status,'email_verified',false);
end $$;
revoke all on function public.eh_auth_create_user(text,text,text,text) from public,anon,authenticated;
grant execute on function public.eh_auth_create_user(text,text,text,text) to service_role;

create or replace function public.eh_auth_login(p_email text,p_password text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_user public.eh_users;
begin
  select * into v_user from public.eh_users where lower(email)=lower(trim(p_email)) and status='active' and email_verified_at is not null and password_hash=crypt(p_password,password_hash);
  if not found then raise exception 'Invalid email or password'; end if;
  update public.eh_users set last_login_at=now() where id=v_user.id;
  return jsonb_build_object('id',v_user.id,'email',v_user.email,'full_name',v_user.full_name,'company_name',v_user.company_name,'role',v_user.role,'status',v_user.status);
end $$;
revoke all on function public.eh_auth_login(text,text) from public,anon,authenticated;
grant execute on function public.eh_auth_login(text,text) to service_role;

create or replace function public.eh_auth_verify_email(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_user public.eh_users;
begin
  update public.eh_users set email_verified_at=coalesce(email_verified_at,now()),updated_at=now() where id=p_user_id and status='active' returning * into v_user;
  if not found then raise exception 'Account not found'; end if;
  update public.eh_profiles set email=v_user.email,full_name=v_user.full_name,company_name=v_user.company_name,role=v_user.role,status=v_user.status,updated_at=now() where id=v_user.id;
  return jsonb_build_object('id',v_user.id,'email',v_user.email,'full_name',v_user.full_name,'company_name',v_user.company_name,'role',v_user.role,'status',v_user.status);
end $$;
revoke all on function public.eh_auth_verify_email(uuid) from public,anon,authenticated;
grant execute on function public.eh_auth_verify_email(uuid) to service_role;

create or replace function public.eh_auth_set_password(p_user_id uuid,p_password text) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
begin
  if length(coalesce(p_password,'')) < 8 then raise exception 'Password must contain at least 8 characters'; end if;
  update public.eh_users set password_hash=crypt(p_password,gen_salt('bf')),session_version=session_version+1,updated_at=now() where id=p_user_id and status='active';
  return found;
end $$;
revoke all on function public.eh_auth_set_password(uuid,text) from public,anon,authenticated;
grant execute on function public.eh_auth_set_password(uuid,text) to service_role;

create or replace function public.eh_purchase_service_for_user(p_user uuid,p_plan_id text,p_term_months integer,p_domain_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_plan public.eh_plans%rowtype; v_term public.eh_billing_terms%rowtype; v_wallet public.eh_wallets%rowtype; v_domain text:=lower(trim(p_domain_name)); v_subtotal numeric(12,2); v_discount numeric(12,2); v_total numeric(12,2); v_order_id uuid; v_service_id uuid; v_tx_id uuid; v_new_balance numeric(14,4);
begin
  if not exists(select 1 from public.eh_users where id=p_user and status='active' and email_verified_at is not null) then raise exception 'Authentication required'; end if;
  if v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then raise exception 'A valid registered domain is required'; end if;
  if exists(select 1 from public.eh_services where lower(domain_name)=v_domain and status<>'cancelled') then raise exception 'This domain already has an email hosting service'; end if;
  select * into v_plan from public.eh_plans where id=p_plan_id and active=true; if not found then raise exception 'Unknown or inactive plan'; end if;
  select * into v_term from public.eh_billing_terms where months=p_term_months and active=true; if not found then raise exception 'Unsupported billing term'; end if;
  select * into v_wallet from public.eh_wallets where user_id=p_user for update; if not found then raise exception 'Wallet not found'; end if;
  v_subtotal:=round((v_plan.monthly_price*v_term.months)::numeric,2); v_discount:=round((v_subtotal*v_term.discount_percent/100)::numeric,2); v_total:=round((v_subtotal-v_discount)::numeric,2);
  insert into public.eh_orders(user_id,plan_id,term_months,domain_name,subtotal,discount_amount,total_amount) values(p_user,v_plan.id,v_term.months,v_domain,v_subtotal,v_discount,v_total) returning id into v_order_id;
  if v_wallet.balance<v_total then
    insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(p_user,'billing','Account credit required',format('Your %s order requires %s USD. Contact support to add credit to your account.',v_plan.name,v_total),'/dashboard/billing','order-credit-'||v_order_id);
    return jsonb_build_object('status','requires_credit','orderId',v_order_id,'total',v_total,'balance',v_wallet.balance,'amountMissing',round(v_total-v_wallet.balance,2));
  end if;
  v_new_balance:=v_wallet.balance-v_total; update public.eh_wallets set balance=v_new_balance where user_id=p_user;
  insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,reference_id,idempotency_key,created_by) values(p_user,'debit',v_total,v_wallet.balance,v_new_balance,format('%s email hosting order for %s',v_plan.name,v_domain),'order',v_order_id,'order-debit-'||v_order_id,p_user) returning id into v_tx_id;
  insert into public.eh_services(user_id,order_id,plan_id,term_months,domain_name,status,mailbox_limit,storage_bytes_per_mailbox,overage_per_gb_month,renews_at) values(p_user,v_order_id,v_plan.id,v_term.months,v_domain,'provisioning',v_plan.mailbox_limit,v_plan.storage_bytes_per_mailbox,v_plan.overage_per_gb_month,now()+make_interval(months=>v_term.months)) returning id into v_service_id;
  update public.eh_orders set status='paid',wallet_transaction_id=v_tx_id,service_id=v_service_id,paid_at=now() where id=v_order_id;
  insert into public.eh_invoices(invoice_number,user_id,service_id,order_id,subtotal,discount_amount,total_amount,status,description,paid_at) values(public.eh_invoice_number(),p_user,v_service_id,v_order_id,v_subtotal,v_discount,v_total,'paid',format('%s · %s months · %s',v_plan.name,v_term.months,v_domain),now());
  insert into public.eh_provisioning_jobs(service_id,job_type,payload,idempotency_key) values(v_service_id,'create_domain',jsonb_build_object('domainName',v_domain),'create-domain-'||v_service_id);
  insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(p_user,'service','Email hosting order paid',format('Provisioning has started for %s.',v_domain),'/dashboard/domains','order-paid-'||v_order_id);
  insert into public.eh_audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) values(p_user,p_user,'service.purchase','service',v_service_id::text,jsonb_build_object('planId',v_plan.id,'termMonths',v_term.months,'domainName',v_domain,'total',v_total));
  return jsonb_build_object('status','paid','orderId',v_order_id,'serviceId',v_service_id,'total',v_total,'balance',v_new_balance);
end $$;
revoke all on function public.eh_purchase_service_for_user(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.eh_purchase_service_for_user(uuid,text,integer,text) to service_role;

create or replace function public.eh_admin_credit_wallet_for_user(p_admin uuid,p_customer_email text,p_amount numeric,p_reason text,p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_customer uuid; v_wallet public.eh_wallets%rowtype; v_key text:=coalesce(nullif(trim(p_idempotency_key),''),gen_random_uuid()::text); v_tx uuid;
begin
  if not exists(select 1 from public.eh_users where id=p_admin and role='admin' and status='active') then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Credit amount must be greater than zero'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A credit reason is required'; end if;
  select id into v_customer from public.eh_users where lower(email)=lower(trim(p_customer_email)) and status='active'; if v_customer is null then raise exception 'Customer account not found'; end if;
  select * into v_wallet from public.eh_wallets where user_id=v_customer for update; if not found then raise exception 'Customer wallet not found'; end if;
  select id into v_tx from public.eh_wallet_transactions where idempotency_key=v_key; if v_tx is not null then return jsonb_build_object('status','duplicate','transactionId',v_tx,'balance',v_wallet.balance); end if;
  update public.eh_wallets set balance=balance+p_amount where user_id=v_customer;
  insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,idempotency_key,created_by) values(v_customer,'credit',p_amount,v_wallet.balance,v_wallet.balance+p_amount,trim(p_reason),'admin_credit',v_key,p_admin) returning id into v_tx;
  insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_customer,'billing','USD credit added',format('%s USD was added to your email hosting account balance.',round(p_amount,2)),'/dashboard/billing','wallet-credit-'||v_tx);
  insert into public.eh_audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) values(p_admin,v_customer,'wallet.credit','wallet_transaction',v_tx::text,jsonb_build_object('amount',p_amount,'reason',trim(p_reason),'idempotencyKey',v_key));
  return jsonb_build_object('status','credited','transactionId',v_tx,'balance',v_wallet.balance+p_amount);
end $$;
revoke all on function public.eh_admin_credit_wallet_for_user(uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.eh_admin_credit_wallet_for_user(uuid,text,numeric,text,text) to service_role;

alter table public.eh_users enable row level security;
alter table public.eh_sessions enable row level security;
alter table public.eh_otp_challenges enable row level security;
revoke all on public.eh_users,public.eh_sessions,public.eh_otp_challenges from anon,authenticated;
