# KmerHosting Email Hosting

Customer-facing email hosting platform for `email-hosting.kmerhosting.com`.

The application sells and manages professional email hosting for domains that customers already own. Domain registration is not included. Mail services are provisioned through the Mailu installation at `mail.kmerhosting.com`.

## Included

- English-only public website and pricing
- Mail Starter: $1.99/month, 10 mailboxes, 100 MB per mailbox
- Mail Plus: $3.95/month, 30 mailboxes, 1 GB per mailbox
- Mail Pro: $5.95/month, 200 mailboxes, 5 GB per mailbox
- Mail Enterprise: $9/month, unlimited mailboxes, 10 GB per mailbox, $0.005/GB/month additional storage
- Terms of 1, 3, 6, 12, 24 and 36 months
- Discounts of 10% for 12 months, 20% for 24 months and 30% for 36 months
- Supabase authentication and Row Level Security
- Prepaid USD account balance with admin-only crediting
- Orders, invoices, transactions and renewal reminders
- Automatic renewal, seven-day grace period, suspension and recovery
- Mailu domain, mailbox and alias provisioning
- DNS record display for MX, SPF, DKIM, DMARC, TLSA and autoconfiguration
- Retryable Mailu provisioning jobs and audit logs
- Privacy Policy and Terms of Service matching the actual platform behavior

## Architecture

```text
Browser
  -> React/Vite frontend
  -> Supabase Auth + PostgreSQL (all product objects use the eh_ prefix)
  -> Supabase Edge Functions
  -> Mailu API at mail.kmerhosting.com
```

The Mailu API token is never sent to the browser. Customers can only access records permitted by RLS. Wallet balances can only be changed through the protected admin function.

## Requirements

- Node.js 22 or newer
- A Supabase project
- Supabase CLI for backend deployment
- A working Mailu installation with its REST API enabled
- A Mailu API token

## Frontend setup

```bash
git clone https://github.com/toscani-tenekeu/Email_Hosting_Plateform.git
cd Email_Hosting_Plateform
cp .env.example .env
npm install
npm run dev
```

Set the following frontend variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_SITE_URL=https://email-hosting.kmerhosting.com
VITE_DOMAIN_STORE_URL=https://domain.kmerhosting.com
VITE_SUPPORT_EMAIL=support@kmerhosting.com
```

Build for production:

```bash
npm run build
npm run preview
```

## Backend deployment

Link the repository to the target Supabase project, then apply the migrations and deploy the functions:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy eh-mail-api
supabase functions deploy eh-automation --no-verify-jwt
```

Set the Mailu secrets once:

```bash
supabase secrets set \
  MAILU_API_BASE=https://mail.kmerhosting.com/api/v1 \
  MAILU_API_TOKEN='REPLACE_WITH_THE_MAILU_API_TOKEN'
```

Configure the project URL used by the internal Mailu worker:

```sql
insert into public.eh_config(key, value)
values ('supabase_url', 'https://YOUR_PROJECT_REF.supabase.co')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

The migration creates these schedules:

- renewal reminders every day;
- due renewal processing every 15 minutes;
- expired grace-period suspension every 15 minutes;
- Mailu provisioning worker every minute.

## First administrator

Create the account normally through the frontend, then promote it once from the Supabase SQL editor:

```sql
update public.eh_profiles
set role = 'admin'
where lower(email) = lower('YOUR_ADMIN_EMAIL');
```

The admin dashboard can then credit customer USD balances and retry automation.

## Supabase Auth settings

Add these URLs to the allowed redirect URLs:

```text
https://email-hosting.kmerhosting.com/**
http://localhost:4173/**
```

Configure the production site URL as:

```text
https://email-hosting.kmerhosting.com
```

## Mailu configuration

The Edge Functions expect the stable Mailu v1 administrative API under:

```text
https://mail.kmerhosting.com/api/v1
```

Mailu must have its API enabled and its API token must match `MAILU_API_TOKEN` in Supabase secrets. The platform uses Mailu to:

- create domains;
- generate DKIM data;
- retrieve DNS configuration;
- create and delete users/mailboxes;
- create and delete aliases;
- suspend or restore all users belonging to an overdue domain.

## Deployment options

### Vercel

Import the GitHub repository, add the `VITE_*` variables, and attach `email-hosting.kmerhosting.com`. `vercel.json` provides the SPA rewrite.

### Docker

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME \
  --build-arg VITE_SITE_URL=https://email-hosting.kmerhosting.com \
  -t kmerhosting-email .

docker run --rm -p 8080:80 kmerhosting-email
```

## Operational notes

- Domain ownership is asserted by the customer during checkout; DNS publication proves practical control.
- No public payment gateway exists. Support verifies payment outside this platform, then an administrator adds USD credit.
- A purchase with insufficient credit remains an unpaid order and does not create a Mailu service.
- Mailbox passwords are sent directly to Mailu and are not stored in plaintext by this application.
- Mailbox content is not exposed through the Supabase API.
- Backups refer to the configured Mailu backup infrastructure. They do not replace independent customer archives.

## Pricing risk notice

The Enterprise price is implemented exactly as specified. Unlimited accounts with 10 GB included per mailbox at $9/month can create unbounded infrastructure cost. Before public launch, enforce a reasonable-use policy, cluster capacity controls and a commercial review of the storage economics.

## License

Copyright 2026 KmerHosting LLC. All rights reserved.
