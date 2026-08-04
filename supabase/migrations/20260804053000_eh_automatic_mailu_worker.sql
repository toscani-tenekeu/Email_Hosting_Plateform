create extension if not exists pg_net with schema extensions;

create table if not exists public.eh_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.eh_config enable row level security;
revoke all on public.eh_config from anon, authenticated;

-- Set this once after linking a fresh Supabase project:
-- insert into public.eh_config(key,value) values ('supabase_url','https://YOUR_PROJECT_REF.supabase.co')
-- on conflict(key) do update set value=excluded.value,updated_at=now();
insert into public.eh_config(key,value) values ('mailu_api_base','https://mail.kmerhosting.com/api/v1')
on conflict(key) do update set value=excluded.value,updated_at=now();

do $$
begin
  if not exists(select 1 from vault.secrets where name='eh_automation_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'eh_automation_secret','Internal Email Hosting automation key');
  end if;
end $$;

create or replace function public.eh_get_automation_secret() returns text language sql security definer set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name='eh_automation_secret' limit 1;
$$;
revoke all on function public.eh_get_automation_secret() from public,anon,authenticated;
grant execute on function public.eh_get_automation_secret() to service_role;

create or replace function public.eh_trigger_mailu_automation() returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare v_url text; v_secret text; v_request_id bigint;
begin
  select value||'/functions/v1/eh-automation' into v_url from public.eh_config where key='supabase_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='eh_automation_secret' limit 1;
  if v_url is null then return null; end if;
  if v_secret is null then raise exception 'Email automation secret is missing'; end if;
  select net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-automation-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=20000) into v_request_id;
  return v_request_id;
end $$;
revoke all on function public.eh_trigger_mailu_automation() from public,anon,authenticated;

DO $$ DECLARE job record; BEGIN FOR job IN select jobid from cron.job where jobname='eh-mailu-worker' LOOP perform cron.unschedule(job.jobid); END LOOP; END $$;
select cron.schedule('eh-mailu-worker','* * * * *','select public.eh_trigger_mailu_automation();');
