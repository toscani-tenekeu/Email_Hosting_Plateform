-- Enforce the number of customer-managed domains allowed by each plan.
-- This migration is additive and only changes eh_ objects.

alter table public.eh_plans
  add column if not exists domain_limit integer;

alter table public.eh_services
  add column if not exists domain_limit integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.eh_plans'::regclass
      and conname = 'eh_plans_domain_limit_positive'
  ) then
    alter table public.eh_plans
      add constraint eh_plans_domain_limit_positive
      check (domain_limit is null or domain_limit > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.eh_services'::regclass
      and conname = 'eh_services_domain_limit_positive'
  ) then
    alter table public.eh_services
      add constraint eh_services_domain_limit_positive
      check (domain_limit is null or domain_limit > 0);
  end if;
end $$;

update public.eh_plans
set domain_limit = case id
  when 'starter' then 5
  when 'plus' then 15
  when 'pro' then 100
  when 'enterprise' then null
  else domain_limit
end,
updated_at = now()
where id in ('starter', 'plus', 'pro', 'enterprise');

update public.eh_services service
set domain_limit = plan.domain_limit
from public.eh_plans plan
where plan.id = service.plan_id;

create or replace function public.eh_purchase_service_for_user(p_user uuid,p_plan_id text,p_term_months integer,p_domain_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_plan public.eh_plans%rowtype;
  v_term public.eh_billing_terms%rowtype;
  v_wallet public.eh_wallets%rowtype;
  v_domain text:=lower(trim(p_domain_name));
  v_domain_count integer;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_total numeric(12,2);
  v_order_id uuid;
  v_service_id uuid;
  v_tx_id uuid;
  v_new_balance numeric(14,4);
begin
  if not exists(select 1 from public.eh_users where id=p_user and status='active' and email_verified_at is not null) then raise exception 'Authentication required'; end if;
  if v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then raise exception 'A valid registered domain is required'; end if;
  select * into v_plan from public.eh_plans where id=p_plan_id and active=true;
  if not found then raise exception 'Unknown or inactive plan'; end if;
  select * into v_term from public.eh_billing_terms where months=p_term_months and active=true;
  if not found then raise exception 'Unsupported billing term'; end if;
  select * into v_wallet from public.eh_wallets where user_id=p_user for update;
  if not found then raise exception 'Wallet not found'; end if;

  select count(*) into v_domain_count
  from public.eh_services
  where user_id=p_user
    and plan_id=v_plan.id
    and status<>'cancelled';

  if v_plan.domain_limit is not null and v_domain_count >= v_plan.domain_limit then
    raise exception '% plan allows up to % domains.', v_plan.name, v_plan.domain_limit;
  end if;

  if exists(select 1 from public.eh_services where lower(domain_name)=v_domain and status<>'cancelled') then raise exception 'This domain already has an email hosting service'; end if;
  v_subtotal:=round((v_plan.monthly_price*v_term.months)::numeric,2); v_discount:=round((v_subtotal*v_term.discount_percent/100)::numeric,2); v_total:=round((v_subtotal-v_discount)::numeric,2);
  insert into public.eh_orders(user_id,plan_id,term_months,domain_name,subtotal,discount_amount,total_amount) values(p_user,v_plan.id,v_term.months,v_domain,v_subtotal,v_discount,v_total) returning id into v_order_id;
  if v_wallet.balance<v_total then
    insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(p_user,'billing','Account credit required',format('Your %s order requires %s USD. Contact support to add credit to your account.',v_plan.name,v_total),'/dashboard/billing','order-credit-'||v_order_id);
    return jsonb_build_object('status','requires_credit','orderId',v_order_id,'total',v_total,'balance',v_wallet.balance,'amountMissing',round(v_total-v_wallet.balance,2));
  end if;
  v_new_balance:=v_wallet.balance-v_total; update public.eh_wallets set balance=v_new_balance where user_id=p_user;
  insert into public.eh_wallet_transactions(user_id,transaction_type,amount,balance_before,balance_after,reason,reference_type,reference_id,idempotency_key,created_by) values(p_user,'debit',v_total,v_wallet.balance,v_new_balance,format('%s email hosting order for %s',v_plan.name,v_domain),'order',v_order_id,'order-debit-'||v_order_id,p_user) returning id into v_tx_id;
  insert into public.eh_services(user_id,order_id,plan_id,term_months,domain_name,status,mailbox_limit,storage_bytes_per_mailbox,overage_per_gb_month,domain_limit,renews_at) values(p_user,v_order_id,v_plan.id,v_term.months,v_domain,'provisioning',v_plan.mailbox_limit,v_plan.storage_bytes_per_mailbox,v_plan.overage_per_gb_month,v_plan.domain_limit,now()+make_interval(months=>v_term.months)) returning id into v_service_id;
  update public.eh_orders set status='paid',wallet_transaction_id=v_tx_id,service_id=v_service_id,paid_at=now() where id=v_order_id;
  insert into public.eh_invoices(invoice_number,user_id,service_id,order_id,subtotal,discount_amount,total_amount,status,description,paid_at) values(public.eh_invoice_number(),p_user,v_service_id,v_order_id,v_subtotal,v_discount,v_total,'paid',format('%s · %s months · %s',v_plan.name,v_term.months,v_domain),now());
  insert into public.eh_provisioning_jobs(service_id,job_type,payload,idempotency_key) values(v_service_id,'create_domain',jsonb_build_object('domainName',v_domain),'create-domain-'||v_service_id);
  insert into public.eh_notifications(user_id,notification_type,title,message,action_url,dedupe_key) values(p_user,'service','Email hosting order paid',format('Provisioning has started for %s.',v_domain),'/dashboard/domains','order-paid-'||v_order_id);
  insert into public.eh_audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,metadata) values(p_user,p_user,'service.purchase','service',v_service_id::text,jsonb_build_object('planId',v_plan.id,'termMonths',v_term.months,'domainName',v_domain,'total',v_total,'domainLimit',v_plan.domain_limit));
  return jsonb_build_object('status','paid','orderId',v_order_id,'serviceId',v_service_id,'total',v_total,'balance',v_new_balance);
end $$;

revoke all on function public.eh_purchase_service_for_user(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.eh_purchase_service_for_user(uuid,text,integer,text) to service_role;
