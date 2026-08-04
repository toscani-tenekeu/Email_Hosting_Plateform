-- Private records are reachable only through the custom-authenticated Edge API.
-- Keep public catalog policies for pricing pages; remove policies that require
-- Supabase Auth from all private product tables.
do $$
declare policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname='public'
      and tablename like 'eh_%'
      and tablename not in ('eh_plans','eh_billing_terms')
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end $$;

drop function if exists public.eh_purchase_service(text,integer,text);
drop function if exists public.eh_admin_credit_wallet(text,numeric,text,text);
drop function if exists public.eh_update_profile(text,text);
drop function if exists public.eh_is_admin();

comment on table public.eh_profiles is 'Legacy product profile compatibility table. Application identity is managed by eh_users; Supabase Auth is not used by Email Hosting.';
