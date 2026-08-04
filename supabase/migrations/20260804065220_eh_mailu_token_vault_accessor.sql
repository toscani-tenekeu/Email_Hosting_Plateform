-- The value is provisioned out-of-band into Vault. Never commit the token.
create or replace function public.eh_get_mailu_api_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'eh_mailu_api_token'
  limit 1;
$$;

revoke all on function public.eh_get_mailu_api_token() from public, anon, authenticated;
grant execute on function public.eh_get_mailu_api_token() to service_role;
