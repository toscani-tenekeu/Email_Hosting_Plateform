-- Meter Enterprise mailbox storage and settle monthly overage charges.
-- All changes are additive and limited to eh_ objects.

alter table public.eh_invoices
  alter column overage_amount type numeric(14,4) using overage_amount::numeric(14,4),
  alter column total_amount type numeric(14,4) using total_amount::numeric(14,4);

create index if not exists eh_storage_usage_mailbox_measured_idx
  on public.eh_storage_usage_snapshots (mailbox_id, measured_at desc);

create or replace function public.eh_record_storage_usage(
  p_mailbox_id uuid,
  p_used_bytes bigint,
  p_measured_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_mailbox public.eh_mailboxes%rowtype;
  v_service public.eh_services%rowtype;
  v_extra_gb numeric(14,4);
begin
  if p_used_bytes is null or p_used_bytes < 0 then
    raise exception 'Storage usage cannot be negative';
  end if;
  if p_measured_at > now() + interval '10 minutes' then
    raise exception 'Storage measurement timestamp is invalid';
  end if;

  select * into v_mailbox
  from public.eh_mailboxes
  where id = p_mailbox_id
  for update;
  if not found then raise exception 'Mailbox not found'; end if;

  select * into v_service
  from public.eh_services
  where id = v_mailbox.service_id;
  if not found then raise exception 'Email hosting service not found'; end if;

  insert into public.eh_storage_usage_snapshots(service_id, mailbox_id, used_bytes, included_bytes, measured_at)
  values(v_service.id, v_mailbox.id, p_used_bytes, v_service.storage_bytes_per_mailbox, p_measured_at);

  update public.eh_mailboxes
  set used_bytes = p_used_bytes,
      last_synced_at = p_measured_at
  where id = v_mailbox.id;

  v_extra_gb := round(greatest(p_used_bytes - v_service.storage_bytes_per_mailbox, 0)::numeric / 1073741824, 4);
  return jsonb_build_object(
    'mailboxId', v_mailbox.id,
    'serviceId', v_service.id,
    'usedBytes', p_used_bytes,
    'includedBytes', v_service.storage_bytes_per_mailbox,
    'extraGb', v_extra_gb,
    'unitPrice', v_service.overage_per_gb_month
  );
end $$;

revoke all on function public.eh_record_storage_usage(uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.eh_record_storage_usage(uuid,bigint,timestamptz) to service_role;

create or replace function public.eh_finalize_storage_overages() returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count integer := 0;
  v_period_start date := (date_trunc('month', current_date::timestamp) - interval '1 month')::date;
  v_period_end date := date_trunc('month', current_date::timestamp)::date - 1;
  v_service record;
  v_charge public.eh_usage_charges%rowtype;
  v_charge_id uuid;
  v_invoice_id uuid;
  v_extra_gb numeric(14,4);
  v_amount numeric(14,4);
  v_wallet public.eh_wallets%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('eh_storage_overage_finalize'));

  for v_service in
    select s.id, s.user_id, s.domain_name, s.overage_per_gb_month, p.name as plan_name
    from public.eh_services s
    join public.eh_plans p on p.id = s.plan_id
    where coalesce(s.overage_per_gb_month, 0) > 0
  loop
    select coalesce(sum(greatest(latest.used_bytes - latest.included_bytes, 0)::numeric / 1073741824), 0)
    into v_extra_gb
    from (
      select distinct on (mailbox_id) used_bytes, included_bytes
      from public.eh_storage_usage_snapshots
      where service_id = v_service.id
        and measured_at >= v_period_start
        and measured_at < v_period_end + 1
      order by mailbox_id, measured_at desc
    ) latest;

    if v_extra_gb <= 0 then continue; end if;
    v_extra_gb := round(v_extra_gb, 4);
    v_amount := round(v_extra_gb * v_service.overage_per_gb_month, 4);

    insert into public.eh_usage_charges(service_id, period_start, period_end, extra_gb, unit_price, amount, status)
    values(v_service.id, v_period_start, v_period_end, v_extra_gb, v_service.overage_per_gb_month, v_amount, 'pending')
    on conflict(service_id, period_start, period_end) do nothing;

    select * into v_charge
    from public.eh_usage_charges
    where service_id = v_service.id
      and period_start = v_period_start
      and period_end = v_period_end
    for update;
    if not found or v_charge.status <> 'pending' then continue; end if;

    if v_charge.invoice_id is null then
      insert into public.eh_invoices(
        invoice_number, user_id, service_id, subtotal, discount_amount, overage_amount,
        total_amount, status, description
      ) values (
        public.eh_invoice_number(), v_service.user_id, v_service.id, 0, 0,
        v_charge.amount, v_charge.amount, 'unpaid',
        format('%s storage overage · %s–%s · %s GB at $%s/GB', v_service.plan_name, v_period_start, v_period_end, v_charge.extra_gb, v_charge.unit_price)
      ) returning id into v_invoice_id;
      update public.eh_usage_charges set invoice_id = v_invoice_id where id = v_charge.id;
      v_charge.invoice_id := v_invoice_id;
    end if;

    select * into v_wallet
    from public.eh_wallets
    where user_id = v_service.user_id
    for update;
    if not found then continue; end if;

    if v_wallet.balance < v_charge.amount then
      insert into public.eh_notifications(user_id, notification_type, title, message, action_url, dedupe_key)
      values(
        v_service.user_id, 'billing', 'Enterprise storage overage requires credit',
        format('%s used %s GB above its included storage during %s–%s. Add %s USD to settle the overage invoice.', v_service.domain_name, v_charge.extra_gb, v_period_start, v_period_end, v_charge.amount - v_wallet.balance),
        '/dashboard/billing', 'storage-overage-credit-' || v_charge.id
      ) on conflict do nothing;
      continue;
    end if;

    update public.eh_wallets
    set balance = balance - v_charge.amount
    where user_id = v_service.user_id;

    insert into public.eh_wallet_transactions(
      user_id, transaction_type, amount, balance_before, balance_after, reason,
      reference_type, reference_id, idempotency_key, created_by
    ) values (
      v_service.user_id, 'debit', v_charge.amount, v_wallet.balance,
      v_wallet.balance - v_charge.amount,
      format('%s storage overage for %s (%s–%s)', v_service.plan_name, v_service.domain_name, v_period_start, v_period_end),
      'storage_overage', v_charge.id, 'storage-overage-' || v_charge.id, v_service.user_id
    ) on conflict(idempotency_key) where idempotency_key is not null do nothing;

    update public.eh_invoices
    set status = 'paid', paid_at = now()
    where id = v_charge.invoice_id;
    update public.eh_usage_charges set status = 'billed' where id = v_charge.id;

    insert into public.eh_notifications(user_id, notification_type, title, message, action_url, dedupe_key)
    values(
      v_service.user_id, 'billing', 'Enterprise storage overage billed',
      format('%s USD was deducted for %s GB of additional storage used during %s–%s.', v_charge.amount, v_charge.extra_gb, v_period_start, v_period_end),
      '/dashboard/billing', 'storage-overage-paid-' || v_charge.id
    ) on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function public.eh_finalize_storage_overages() from public,anon,authenticated;
grant execute on function public.eh_finalize_storage_overages() to service_role;
