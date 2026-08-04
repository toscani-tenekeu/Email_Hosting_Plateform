-- Keep the four required prices and mailbox/storage limits unchanged.
-- This migration only refreshes the customer-facing feature catalog.
update public.eh_plans
set description = case id
  when 'starter' then 'Essential professional email for small teams.'
  when 'plus' then 'More mailboxes and storage for growing businesses.'
  when 'pro' then 'High-capacity email hosting for organizations.'
  when 'enterprise' then 'Unlimited email accounts with metered additional storage.'
  else description
end,
features = case id
  when 'starter' then '["10 professional email accounts","100 MB storage per mailbox","1 customer-owned domain per service","Roundcube Webmail access","IMAP and SMTP client access","Email filtering rules with ManageSieve","Mailing list routing","Aliases, domain aliases and forwarding","Automatic replies and fetched accounts","Full-text search for messages and attachments","DKIM signing","SPF and DMARC guidance","TLS, spam and malware protection","Auto-configuration for email clients","Automatic backups","Renewal reminders and grace-period recovery"]'::jsonb
  when 'plus' then '["30 professional email accounts","1 GB storage per mailbox","1 customer-owned domain per service","Roundcube Webmail access","IMAP and SMTP client access","Email filtering rules with ManageSieve","Mailing list routing","Aliases, domain aliases and forwarding","Automatic replies and fetched accounts","Full-text search for messages and attachments","DKIM signing","SPF and DMARC guidance","TLS, spam and malware protection","Auto-configuration for email clients","Automatic backups","Renewal reminders and grace-period recovery"]'::jsonb
  when 'pro' then '["200 professional email accounts","5 GB storage per mailbox","1 customer-owned domain per service","Roundcube Webmail access","IMAP and SMTP client access","Email filtering rules with ManageSieve","Mailing list routing","Aliases, domain aliases and forwarding","Automatic replies and fetched accounts","Full-text search for messages and attachments","DKIM signing","SPF and DMARC guidance","TLS, spam and malware protection","Auto-configuration for email clients","Automatic backups","Renewal reminders and grace-period recovery"]'::jsonb
  when 'enterprise' then '["Unlimited professional email accounts","10 GB storage per mailbox","$0.005 per additional GB per month","1 customer-owned domain per service","Roundcube Webmail access","IMAP and SMTP client access","Email filtering rules with ManageSieve","Mailing list routing","Aliases, domain aliases and forwarding","Automatic replies and fetched accounts","Full-text search for messages and attachments","DKIM signing","SPF and DMARC guidance","TLS, spam and malware protection","Auto-configuration for email clients","Automatic backups","Renewal reminders and grace-period recovery"]'::jsonb
  else features
end,
updated_at = now()
where id in ('starter','plus','pro','enterprise');
