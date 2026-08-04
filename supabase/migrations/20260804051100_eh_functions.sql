create or replace function public.eh_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['eh_profiles','eh_wallets','eh_plans','eh_mailu_clusters','eh_orders','eh_services','eh_mailboxes','eh_aliases','eh_autoresponders','eh_dns_records','eh_provisioning_jobs'] LOOP
    execute format('drop trigger if exists %I on public.%I',t||'_set_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function public.eh_set_updated_at()',t||'_set_updated_at',t);
  END LOOP;
END $$;

create or replace function public.eh_handle_new_auth_user() returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  insert into public.eh_profiles(id,email,full_name) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing;
  insert into public.eh_wallets(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end $$;
drop trigger if exists eh_on_auth_user_created on auth.users;
create trigger eh_on_auth_user_created after insert on auth.users for each row execute function public.eh_handle_new_auth_user();
insert into public.eh_profiles(id,email,full_name) select id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name','') from auth.users on conflict(id) do nothing;
insert into public.eh_wallets(user_id) select id from public.eh_profiles on conflict(user_id) do nothing;

create or replace function public.eh_is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.eh_profiles where id=auth.uid() and role='admin' and status='active');
$$;

create or replace function public.eh_invoice_number() returns text language plpgsql security definer set search_path=public as $$
declare v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('eh_invoice_number'));
  select coalesce(max((regexp_match(invoice_number,'([0-9]+)$'))[1]::bigint),0)+1 into v_next from public.eh_invoices where invoice_number like 'EH-'||extract(year from now())::int||'-%';
  return format('EH-%s-%s',extract(year from now())::int,lpad(v_next::text,6,'0'));
end $$;

create or replace function public.eh_purchase_service(p_plan_id text,p_term_months integer,p_domain_name text) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_plan public.eh_plans%rowtype; v_term public.eh_billing_terms%rowtype; v_wallet public.eh_wallets%rowtype;
  v_domain text:=lower(trim(p_domain_name)); v_subtotal numeric(12,2); v_discount numeric(12,2); v_total numeric(12,2);
  v_order_id uuid; v_service_id uuid; v_tx_id uuid; v_new_balance numeric(14,4);
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then raise exception 'A valid registered domain is required'; end if;
  if exists(select 1 from public.eh_services where lower(domain_name)=v_domain and status<>'cancelled') then raise exception 'This domain already has an email hosting service'; end if;
  select * into v_plan from public.eh_plans where id=p_plan_id and active=true; if not found then raise exception 'Unknown or inactive plan'; end if;
  select * into v_term from public.eh_billing_terms where months=p_term_months and active=true; if not found then raise exception 'Unsupported billing term'; end if;
  select * into v_wallet from public.eh_wallets where user_id=v_user for update; if not found then raise exception 'Wallet not found'; end if;
  v_subtotal:=round((v_plan.monthly_price*v_term.months)::numeric,2); v_discount:=round((v_subtotal*v_term.discount_percent/100)::numeric,2); v_total:=round((v_subtotal-v_discount)::numeric,2);
  insert into public.eh_orders(user_id,plan_id,term_months,domain_name,subtotal,discount_amount,total_amount) values(v_user,v_plan.id,v_term.months,v_domain,v_subtotal,v_discount,v_total) returning id into v_order_id;
  if v_wallet.balance<v_total then
    insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_user,'billing','Account credit required',format('Your %s order requires %s USD. Contact support to add credit to your account.',v_plan.name,v_total),'/dashboard/billing','order-credit-'||v_order_id);
    return jsonb_build_object('status','requires_credit','orderId',v_order_id,'total',v_total,'balance',v_wallet.balance,'amountMissing',round(v_total-v_wallet.balance,2));
  end if;
  v_new_balance:=v_wallet.balance-v_total; update public.eh_wallets set balance=v_new_balance where user_id=v_user;
  insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,reference_id,idempotency_key,created_by)
  values(v_user,'debit',v_total,v_wallet.balance,v_new_balance,format('%s email hosting order for %s',v_plan.name,v_domain),'order',v_order_id,'order-debit-'||v_order_id,v_user) returning id into v_tx_id;
  insert into public.eh_services(user_id,order_id,plan_id,term_months,domain_name,status,mailbox_limit,storage_bytes_per_mailbox,overage_per_gb_month,renews_at)
  values(v_user,v_order_id,v_plan.id,v_term.months,v_domain,'provisioning',v_plan.mailbox_limit,v_plan.storage_bytes_per_mailbox,v_plan.overage_per_gb_month,now()+make_interval(months=>v_term.months)) returning id into v_service_id;
  update public.eh_orders set status='paid',wallet_transaction_id=v_tx_id,service_id=v_service_id,paid_at=now() where id=v_order_id;
  insert into public.eh_invoices(invoice_number,user_id,service_id,order_id,subtotal,discount_amount,total_amount,status,description,paid_at)
  values(public.eh_invoice_number(),v_user,v_service_id,v_order_id,v_subtotal,v_discount,v_total,'paid',format('%s · %s months · %s',v_plan.name,v_term.months,v_domain),now());
  insert into public.eh_provisioning_jobs(service_id,job_type,payload,idempotency_key) values(v_service_id,'create_domain',jsonb_build_object('domainName',v_domain),'create-domain-'||v_service_id);
  insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_user,'service','Email hosting order paid',format('Provisioning has started for %s.',v_domain),'/dashboard/domains','order-paid-'||v_order_id);
  insert into public.eh_audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) values(v_user,v_user,'service.purchase','service',v_service_id::text,jsonb_build_object('planId',v_plan.id,'termMonths',v_term.months,'domainName',v_domain,'total',v_total));
  return jsonb_build_object('status','paid','orderId',v_order_id,'serviceId',v_service_id,'total',v_total,'balance',v_new_balance);
end $$;

create or replace function public.eh_admin_credit_wallet(p_customer_email text,p_amount numeric,p_reason text,p_idempotency_key text default null) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_admin uuid:=auth.uid(); v_customer uuid; v_wallet public.eh_wallets%rowtype; v_key text:=coalesce(nullif(trim(p_idempotency_key),''),gen_random_uuid()::text); v_tx uuid;
begin
  if not public.eh_is_admin() then raise exception 'Administrator access required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Credit amount must be greater than zero'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A credit reason is required'; end if;
  select id into v_customer from auth.users where lower(email)=lower(trim(p_customer_email)); if v_customer is null then raise exception 'Customer account not found'; end if;
  select * into v_wallet from public.eh_wallets where user_id=v_customer for update; if not found then raise exception 'Customer wallet not found'; end if;
  select id into v_tx from public.eh_wallet_transactions where idempotency_key=v_key; if v_tx is not null then return jsonb_build_object('status','duplicate','transactionId',v_tx,'balance',v_wallet.balance); end if;
  update public.eh_wallets set balance=balance+p_amount where user_id=v_customer;
  insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,idempotency_key,created_by)
  values(v_customer,'credit',p_amount,v_wallet.balance,v_wallet.balance+p_amount,trim(p_reason),'admin_credit',v_key,v_admin) returning id into v_tx;
  insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_customer,'billing','USD credit added',format('%s USD was added to your email hosting account balance.',round(p_amount,2)),'/dashboard/billing','wallet-credit-'||v_tx);
  insert into public.eh_audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) values(v_admin,v_customer,'wallet.credit','wallet_transaction',v_tx::text,jsonb_build_object('amount',p_amount,'reason',trim(p_reason),'idempotencyKey',v_key));
  return jsonb_build_object('status','credited','transactionId',v_tx,'balance',v_wallet.balance+p_amount);
end $$;

create or replace function public.eh_update_profile(p_full_name text,p_company_name text default null) returns public.eh_profiles language plpgsql security definer set search_path=public as $$
declare v_profile public.eh_profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.eh_profiles set full_name=trim(coalesce(p_full_name,'')),company_name=nullif(trim(coalesce(p_company_name,'')),'') where id=auth.uid() returning * into v_profile;
  return v_profile;
end $$;

create or replace function public.eh_queue_renewal_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0; v_service record; v_days integer;
begin
  for v_service in select s.*,p.name plan_name,pr.email from public.eh_services s join public.eh_plans p on p.id=s.plan_id join public.eh_profiles pr on pr.id=s.user_id where s.status='active' and s.renews_at::date between current_date and current_date+30 loop
    v_days:=v_service.renews_at::date-current_date;
    if v_days in(30,14,7,3,1,0) then
      insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key)
      values(v_service.user_id,'renewal',case when v_days=0 then 'Email hosting renewal due today' else format('Email hosting renews in %s day%s',v_days,case when v_days=1 then '' else 's' end) end,format('%s for %s will renew from your USD balance on %s.',v_service.plan_name,v_service.domain_name,v_service.renews_at::date),'/dashboard/billing',format('renewal-reminder-%s-%s',v_service.id,v_days)) on conflict do nothing;
      if found then
        insert into public.eh_email_outbox(user_id,recipient,template_key,subject,payload) values(v_service.user_id,v_service.email,'renewal_reminder',case when v_days=0 then 'Email hosting renewal due today' else format('Email hosting renews in %s days',v_days) end,jsonb_build_object('serviceId',v_service.id,'domainName',v_service.domain_name,'planName',v_service.plan_name,'days',v_days,'renewsAt',v_service.renews_at));
        v_count:=v_count+1;
      end if;
    end if;
  end loop;
  return v_count;
end $$;

create or replace function public.eh_process_due_renewals() returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0; v_service record; v_wallet public.eh_wallets%rowtype; v_subtotal numeric(12,2); v_discount numeric(12,2); v_total numeric(12,2); v_was_suspended boolean;
begin
  for v_service in select s.*,p.name plan_name,p.monthly_price,t.discount_percent from public.eh_services s join public.eh_plans p on p.id=s.plan_id join public.eh_billing_terms t on t.months=s.term_months where s.status in('active','past_due','suspended') and s.renews_at<=now() order by s.renews_at for update of s skip locked loop
    select * into v_wallet from public.eh_wallets where user_id=v_service.user_id for update;
    v_subtotal:=round(v_service.monthly_price*v_service.term_months,2); v_discount:=round(v_subtotal*v_service.discount_percent/100,2); v_total:=round(v_subtotal-v_discount,2); v_was_suspended:=v_service.status='suspended';
    if v_service.auto_renew and v_wallet.balance>=v_total then
      update public.eh_wallets set balance=balance-v_total where user_id=v_service.user_id;
      insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,reference_id,idempotency_key,created_by)
      values(v_service.user_id,'debit',v_total,v_wallet.balance,v_wallet.balance-v_total,format('%s renewal for %s',v_service.plan_name,v_service.domain_name),'service_renewal',v_service.id,format('renewal-%s-%s',v_service.id,v_service.renews_at::date),v_service.user_id)
      on conflict(idempotency_key) where idempotency_key is not null do nothing;
      update public.eh_services set status='active',grace_ends_at=null,suspended_at=null,renews_at=greatest(v_service.renews_at,now())+make_interval(months=>v_service.term_months) where id=v_service.id;
      insert into public.eh_invoices(invoice_number,user_id,service_id,subtotal,discount_amount,total_amount,status,description,paid_at)
      values(public.eh_invoice_number(),v_service.user_id,v_service.id,v_subtotal,v_discount,v_total,'paid',format('%s renewal · %s months · %s',v_service.plan_name,v_service.term_months,v_service.domain_name),now());
      if v_was_suspended then insert into public.eh_provisioning_jobs(service_id,job_type,payload,idempotency_key) values(v_service.id,'resume_domain',jsonb_build_object('domainName',v_service.domain_name),format('resume-domain-%s-%s',v_service.id,current_date)) on conflict do nothing; end if;
      insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_service.user_id,'renewal','Email hosting renewed',format('%s USD was deducted from your balance. %s is active again.',v_total,v_service.domain_name),'/dashboard/billing',format('renewal-paid-%s-%s',v_service.id,v_service.renews_at::date)) on conflict do nothing;
    elsif v_service.status<>'suspended' then
      update public.eh_services set status='past_due',grace_ends_at=coalesce(grace_ends_at,now()+interval '7 days') where id=v_service.id;
      insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(v_service.user_id,'billing','Email hosting payment required',format('Your USD balance is insufficient to renew %s. Add credit before the grace period ends.',v_service.domain_name),'/dashboard/billing',format('renewal-failed-%s-%s',v_service.id,current_date)) on conflict do nothing;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.eh_suspend_expired_services() returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  with suspended as (
    update public.eh_services set status='suspended',suspended_at=now() where status='past_due' and grace_ends_at is not null and grace_ends_at<=now() returning id,user_id,domain_name
  ), jobs as (
    insert into public.eh_provisioning_jobs(service_id,job_type,payload,idempotency_key) select id,'suspend_domain',jsonb_build_object('domainName',domain_name),'suspend-domain-'||id||'-'||current_date from suspended on conflict do nothing
  ), notices as (
    insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) select user_id,'service','Email hosting suspended',format('%s was suspended because the renewal grace period expired.',domain_name),'/dashboard/billing','service-suspended-'||id from suspended on conflict do nothing
  ) select count(*) into v_count from suspended;
  return v_count;
end $$;
