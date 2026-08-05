-- Replace the retired one-domain feature with the enforced plan capacity.

update public.eh_plans
set features = replace(features::text, '"1 customer-owned domain per service"', '"5 managed domains"')::jsonb,
    updated_at = now()
where id = 'starter';

update public.eh_plans
set features = replace(features::text, '"1 customer-owned domain per service"', '"15 managed domains"')::jsonb,
    updated_at = now()
where id = 'plus';

update public.eh_plans
set features = replace(features::text, '"1 customer-owned domain per service"', '"100 managed domains"')::jsonb,
    updated_at = now()
where id = 'pro';

update public.eh_plans
set features = replace(features::text, '"1 customer-owned domain per service"', '"Unlimited managed domains"')::jsonb,
    updated_at = now()
where id = 'enterprise';
