-- Public pricing must not call the admin-only helper from an anonymous RLS check.
drop policy if exists eh_plans_public_select on public.eh_plans;
create policy eh_plans_public_select on public.eh_plans
  for select
  using (active = true);

drop policy if exists eh_billing_terms_public_select on public.eh_billing_terms;
create policy eh_billing_terms_public_select on public.eh_billing_terms
  for select
  using (active = true);
