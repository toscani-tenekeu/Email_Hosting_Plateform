create or replace function public.eh_process_due_renewals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_service record;
  v_wallet public.eh_wallets%rowtype;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_total numeric(12,2);
  v_tx uuid;
  v_was_suspended boolean;
begin
  for v_service in
    select s.*, p.name as plan_name, p.monthly_price, t.discount_percent
    from public.eh_services s
    join public.eh_plans p on p.id = s.plan_id
    join public.eh_billing_terms t on t.months = s.term_months
    where s.status in ('active', 'past_due', 'suspended') and s.renews_at <= now()
    order by s.renews_at
    for update of s skip locked
  loop
    select * into v_wallet from public.eh_wallets where user_id = v_service.user_id for update;
    v_subtotal := round(v_service.monthly_price * v_service.term_months, 2);
    v_discount := round(v_subtotal * v_service.discount_percent / 100, 2);
    v_total := round(v_subtotal - v_discount, 2);
    v_was_suspended := v_service.status = 'suspended';

    if v_service.auto_renew and v_wallet.balance >= v_total then
      update public.eh_wallets set balance = balance - v_total where user_id = v_service.user_id;
      insert into public.eh_wallet_transactions (
        user_id, transaction_type, amount, balance_before, balance_after, reason,
        reference_type, reference_id, idempotency_key, created_by
      ) values (
        v_service.user_id, 'debit', v_total, v_wallet.balance, v_wallet.balance - v_total,
        format('%s renewal for %s', v_service.plan_name, v_service.domain_name),
        'service_renewal', v_service.id,
        format('renewal-%s-%s', v_service.id, v_service.renews_at::date), v_service.user_id
      ) on conflict (idempotency_key) where idempotency_key is not null do nothing
      returning id into v_tx;

      update public.eh_services
      set status = 'active', grace_ends_at = null, suspended_at = null,
          renews_at = greatest(v_service.renews_at, now()) + make_interval(months => v_service.term_months)
      where id = v_service.id;

      insert into public.eh_invoices (
        invoice_number, user_id, service_id, subtotal, discount_amount, total_amount,
        status, description, paid_at
      ) values (
        public.eh_invoice_number(), v_service.user_id, v_service.id, v_subtotal, v_discount, v_total,
        'paid', format('%s renewal · %s months · %s', v_service.plan_name, v_service.term_months, v_service.domain_name), now()
      );

      if v_was_suspended then
        insert into public.eh_provisioning_jobs (service_id, job_type, payload, idempotency_key)
        values (v_service.id, 'resume_domain', jsonb_build_object('domainName', v_service.domain_name),
          format('resume-domain-%s-%s', v_service.id, current_date))
        on conflict do nothing;
      end if;

      insert into public.eh_notifications (user_id, notification_type, title, message, action_url, dedupe_key)
      values (
        v_service.user_id, 'renewal', 'Email hosting renewed',
        format('%s USD was deducted from your balance. %s is active again.', v_total, v_service.domain_name),
        '/dashboard/billing', format('renewal-paid-%s-%s', v_service.id, v_service.renews_at::date)
      ) on conflict do nothing;
    elsif v_service.status <> 'suspended' then
      update public.eh_services
      set status = 'past_due', grace_ends_at = coalesce(grace_ends_at, now() + interval '7 days')
      where id = v_service.id;

      insert into public.eh_notifications (user_id, notification_type, title, message, action_url, dedupe_key)
      values (
        v_service.user_id, 'billing', 'Email hosting payment required',
        format('Your USD balance is insufficient to renew %s. Add credit before the grace period ends.', v_service.domain_name),
        '/dashboard/billing', format('renewal-failed-%s-%s', v_service.id, current_date)
      ) on conflict do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create extension if not exists pg_cron with schema extensions;

do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname in ('eh-renewal-reminders','eh-due-renewals','eh-suspend-expired') loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

select cron.schedule('eh-renewal-reminders', '15 1 * * *', 'select public.eh_queue_renewal_reminders();');
select cron.schedule('eh-due-renewals', '*/15 * * * *', 'select public.eh_process_due_renewals();');
select cron.schedule('eh-suspend-expired', '*/15 * * * *', 'select public.eh_suspend_expired_services();');
