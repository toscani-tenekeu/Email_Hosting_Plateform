-- Server-side destination for DNS assistance requests.
-- The user address is supplied as Reply-To by the Edge Function; this value
-- must never be controlled by the frontend.
insert into public.eh_config(key, value)
values ('support_email', 'support@kmerhosting.com')
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
