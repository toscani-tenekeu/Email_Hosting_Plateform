-- KmerHosting Email Hosting Platform
-- All product-owned database objects use the eh_ prefix.

create extension if not exists pgcrypto with schema extensions;

DO $$ BEGIN create type public.eh_user_role as enum ('customer', 'admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_account_status as enum ('active', 'disabled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_order_status as enum ('awaiting_credit', 'paid', 'cancelled', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_service_status as enum ('provisioning', 'active', 'past_due', 'suspended', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_invoice_status as enum ('paid', 'unpaid', 'void'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN create type public.eh_wallet_transaction_type as enum ('credit', 'debit', 'refund', 'adjustment'); EXCEPTION WHEN duplicate_object THEN null; END $$;

create table if not exists public.eh_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  company_name text,
  role public.eh_user_role not null default 'customer',
  status public.eh_account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eh_profiles_email_unique on public.eh_profiles (lower(email));

create table if not exists public.eh_wallets (
  user_id uuid primary key references public.eh_profiles(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  balance numeric(14,4) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.eh_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.eh_profiles(id) on delete cascade,
  transaction_type public.eh_wallet_transaction_type not null,
  amount numeric(14,4) not null check (amount > 0),
  balance_before numeric(14,4) not null check (balance_before >= 0),
  balance_after numeric(14,4) not null check (balance_after >= 0),
  reason text not null,
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  created_by uuid references public.eh_profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists eh_wallet_transactions_idempotency_unique on public.eh_wallet_transactions (idempotency_key) where idempotency_key is not null;
create index if not exists eh_wallet_transactions_user_created_idx on public.eh_wallet_transactions (user_id, created_at desc);

create table if not exists public.eh_plans (
  id text primary key,
  name text not null,
  monthly_price numeric(12,4) not null check (monthly_price >= 0),
  mailbox_limit integer check (mailbox_limit is null or mailbox_limit > 0),
  storage_bytes_per_mailbox bigint not null check (storage_bytes_per_mailbox > 0),
  overage_per_gb_month numeric(12,6),
  description text not null,
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eh_billing_terms (
  months integer primary key check (months in (1,3,6,12,24,36)),
  label text not null,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  active boolean not null default true
);

create table if not exists public.eh_mailu_clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  api_base_url text not null,
  webmail_url text,
  imap_hostname text,
  smtp_hostname text,
  pop3_hostname text,
  enabled boolean not null default true,
  priority integer not null default 100,
  mailbox_capacity integer,
  mailbox_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.eh_mailu_clusters.api_base_url is 'API endpoint only. Mailu API tokens are stored as Edge Function secrets.';

create table if not exists public.eh_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.eh_profiles(id) on delete restrict,
  plan_id text not null references public.eh_plans(id),
  term_months integer not null references public.eh_billing_terms(months),
  domain_name text not null,
  status public.eh_order_status not null default 'awaiting_credit',
  subtotal numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  wallet_transaction_id uuid references public.eh_wallet_transactions(id),
  service_id uuid,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists eh_orders_user_created_idx on public.eh_orders (user_id, created_at desc);

create table if not exists public.eh_services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.eh_profiles(id) on delete restrict,
  order_id uuid references public.eh_orders(id) on delete set null,
  plan_id text not null references public.eh_plans(id),
  term_months integer not null references public.eh_billing_terms(months),
  domain_name text not null,
  status public.eh_service_status not null default 'provisioning',
  mailbox_limit integer,
  storage_bytes_per_mailbox bigint not null,
  overage_per_gb_month numeric(12,6),
  cluster_id uuid references public.eh_mailu_clusters(id) on delete set null,
  auto_renew boolean not null default true,
  mailu_domain_created boolean not null default false,
  starts_at timestamptz not null default now(),
  renews_at timestamptz not null,
  grace_ends_at timestamptz,
  suspended_at timestamptz,
  cancelled_at timestamptz,
  last_provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eh_orders drop constraint if exists eh_orders_service_id_fkey;
alter table public.eh_orders add constraint eh_orders_service_id_fkey foreign key (service_id) references public.eh_services(id) on delete set null;
create unique index if not exists eh_services_domain_active_unique on public.eh_services (lower(domain_name)) where status <> 'cancelled';
create index if not exists eh_services_user_status_idx on public.eh_services (user_id, status);
create index if not exists eh_services_renewal_idx on public.eh_services (renews_at) where status in ('active','past_due','suspended');

create table if not exists public.eh_mailboxes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.eh_services(id) on delete cascade,
  user_id uuid not null references public.eh_profiles(id) on delete cascade,
  email text not null,
  local_part text not null,
  display_name text,
  quota_bytes bigint not null check (quota_bytes > 0),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  enabled boolean not null default true,
  imap_enabled boolean not null default true,
  pop3_enabled boolean not null default false,
  spam_filter_enabled boolean not null default true,
  mailu_synced boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eh_mailboxes_email_unique on public.eh_mailboxes (lower(email));
create index if not exists eh_mailboxes_service_idx on public.eh_mailboxes (service_id, created_at);

create table if not exists public.eh_aliases (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.eh_services(id) on delete cascade,
  user_id uuid not null references public.eh_profiles(id) on delete cascade,
  email text not null,
  destinations text[] not null,
  wildcard boolean not null default false,
  enabled boolean not null default true,
  mailu_synced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eh_aliases_email_unique on public.eh_aliases (lower(email));

create table if not exists public.eh_autoresponders (
  mailbox_id uuid primary key references public.eh_mailboxes(id) on delete cascade,
  enabled boolean not null default false,
  subject text,
  body text,
  starts_on date,
  ends_on date,
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.eh_dns_records (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.eh_services(id) on delete cascade,
  record_type text not null,
  hostname text not null,
  value text not null,
  priority integer,
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, record_type, hostname, value)
);

create table if not exists public.eh_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  user_id uuid not null references public.eh_profiles(id) on delete restrict,
  service_id uuid references public.eh_services(id) on delete set null,
  order_id uuid references public.eh_orders(id) on delete set null,
  subtotal numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  overage_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  currency text not null default 'USD' check (currency = 'USD'),
  status public.eh_invoice_status not null,
  description text not null,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists eh_invoices_user_issued_idx on public.eh_invoices (user_id, issued_at desc);

create table if not exists public.eh_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.eh_profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  action_url text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists eh_notifications_dedupe_unique on public.eh_notifications (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists eh_notifications_user_created_idx on public.eh_notifications (user_id, created_at desc);

create table if not exists public.eh_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.eh_profiles(id) on delete set null,
  recipient text not null,
  template_key text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.eh_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.eh_services(id) on delete cascade,
  mailbox_id uuid references public.eh_mailboxes(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.eh_job_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 10,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eh_provisioning_jobs_idempotency_unique on public.eh_provisioning_jobs (idempotency_key) where idempotency_key is not null;
create index if not exists eh_provisioning_jobs_pending_idx on public.eh_provisioning_jobs (next_attempt_at, created_at) where status in ('pending','failed');

create table if not exists public.eh_storage_usage_snapshots (
  id bigserial primary key,
  service_id uuid not null references public.eh_services(id) on delete cascade,
  mailbox_id uuid not null references public.eh_mailboxes(id) on delete cascade,
  used_bytes bigint not null check (used_bytes >= 0),
  included_bytes bigint not null check (included_bytes >= 0),
  measured_at timestamptz not null default now()
);
create index if not exists eh_storage_usage_service_measured_idx on public.eh_storage_usage_snapshots (service_id, measured_at desc);

create table if not exists public.eh_usage_charges (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.eh_services(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  extra_gb numeric(14,4) not null default 0,
  unit_price numeric(12,6) not null,
  amount numeric(12,4) not null default 0,
  status text not null default 'pending' check (status in ('pending','billed','waived')),
  invoice_id uuid references public.eh_invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (service_id, period_start, period_end),
  check (period_end >= period_start)
);

create table if not exists public.eh_audit_logs (
  id bigserial primary key,
  actor_user_id uuid references public.eh_profiles(id) on delete set null,
  target_user_id uuid references public.eh_profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.eh_cron_runs (
  id bigserial primary key,
  job_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  processed_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

insert into public.eh_plans (id,name,monthly_price,mailbox_limit,storage_bytes_per_mailbox,overage_per_gb_month,description,features,sort_order)
values
('starter','Mail Starter',1.99,10,104857600,null,'Essential professional email for small teams.','["Professional email on your own domain","100 MB storage per mailbox","DKIM signing","SPF and DMARC guidance","Automatic replies","Email forwarding and aliases","Spam and malware filtering","TLS","IMAP, SMTP and POP3","Automatic backups","Renewal reminders"]',10),
('plus','Mail Plus',3.95,30,1073741824,null,'More mailboxes and storage for growing businesses.','["Professional email on your own domain","1 GB storage per mailbox","DKIM signing","SPF and DMARC guidance","Automatic replies","Email forwarding and aliases","Spam and malware filtering","TLS","IMAP, SMTP and POP3","Automatic backups","Renewal reminders"]',20),
('pro','Mail Pro',5.95,200,5368709120,null,'High-capacity email hosting for organizations.','["Professional email on your own domain","5 GB storage per mailbox","DKIM signing","SPF and DMARC guidance","Automatic replies","Email forwarding and aliases","Spam and malware filtering","TLS","IMAP, SMTP and POP3","Automatic backups","Renewal reminders"]',30),
('enterprise','Mail Enterprise',9.00,null,10737418240,0.005,'Unlimited email accounts with metered additional storage.','["Unlimited professional mailboxes","10 GB storage per mailbox","$0.005 per additional GB per month","DKIM signing","SPF and DMARC guidance","Automatic replies","Email forwarding and aliases","Spam and malware filtering","TLS","IMAP, SMTP and POP3","Automatic backups","Renewal reminders"]',40)
on conflict (id) do update set name=excluded.name,monthly_price=excluded.monthly_price,mailbox_limit=excluded.mailbox_limit,storage_bytes_per_mailbox=excluded.storage_bytes_per_mailbox,overage_per_gb_month=excluded.overage_per_gb_month,description=excluded.description,features=excluded.features,sort_order=excluded.sort_order,updated_at=now();

insert into public.eh_billing_terms(months,label,discount_percent) values
(1,'Monthly',0),(3,'3 months',0),(6,'6 months',0),(12,'1 year',10),(24,'2 years',20),(36,'3 years',30)
on conflict (months) do update set label=excluded.label,discount_percent=excluded.discount_percent,active=true;
