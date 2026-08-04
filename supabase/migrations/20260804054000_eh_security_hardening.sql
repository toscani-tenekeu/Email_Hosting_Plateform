alter function public.eh_set_updated_at() set search_path = public;

revoke execute on function public.eh_handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.eh_invoice_number() from public, anon, authenticated;
revoke execute on function public.eh_is_admin() from public, anon;
revoke execute on function public.eh_purchase_service(text, integer, text) from public, anon;
revoke execute on function public.eh_admin_credit_wallet(text, numeric, text, text) from public, anon;
revoke execute on function public.eh_update_profile(text, text) from public, anon;
revoke execute on function public.eh_queue_renewal_reminders() from public, anon, authenticated;
revoke execute on function public.eh_process_due_renewals() from public, anon, authenticated;
revoke execute on function public.eh_suspend_expired_services() from public, anon, authenticated;
revoke execute on function public.eh_trigger_mailu_automation() from public, anon, authenticated;

grant execute on function public.eh_is_admin() to authenticated, service_role;
grant execute on function public.eh_purchase_service(text, integer, text) to authenticated;
grant execute on function public.eh_admin_credit_wallet(text, numeric, text, text) to authenticated;
grant execute on function public.eh_update_profile(text, text) to authenticated;
grant execute on function public.eh_queue_renewal_reminders() to service_role;
grant execute on function public.eh_process_due_renewals() to service_role;
grant execute on function public.eh_suspend_expired_services() to service_role;
grant execute on function public.eh_get_automation_secret() to service_role;

drop policy if exists eh_config_admin_select on public.eh_config;
create policy eh_config_admin_select on public.eh_config for select using (public.eh_is_admin());
drop policy if exists eh_email_outbox_admin_select on public.eh_email_outbox;
create policy eh_email_outbox_admin_select on public.eh_email_outbox for select using (public.eh_is_admin());
