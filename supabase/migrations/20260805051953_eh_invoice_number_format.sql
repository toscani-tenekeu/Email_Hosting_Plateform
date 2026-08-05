-- Use an explicit, account-level invoice prefix for new invoices.
-- Existing invoice numbers remain immutable for accounting traceability.

create or replace function public.eh_invoice_number() returns text
language plpgsql security definer set search_path=public as $$
declare
  v_year integer := extract(year from now())::integer;
  v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('eh_invoice_number'));

  select coalesce(max((regexp_match(invoice_number, '([0-9]+)$'))[1]::bigint), 0) + 1
  into v_next
  from public.eh_invoices
  where invoice_number ~ ('^(EH|INV)-' || v_year::text || '-[0-9]+$');

  return format('INV-%s-%s', v_year, lpad(v_next::text, 6, '0'));
end $$;

revoke execute on function public.eh_invoice_number() from public, anon, authenticated;
grant execute on function public.eh_invoice_number() to service_role;
