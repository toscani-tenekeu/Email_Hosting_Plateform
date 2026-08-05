export const fallbackPlans = [
  {
    id: 'starter',
    name: 'Mail Starter',
    monthly_price: 1.99,
    domain_limit: 5,
    mailbox_limit: 10,
    storage_bytes_per_mailbox: 100 * 1024 * 1024,
    overage_per_gb_month: null,
    description: 'Essential professional email for small teams.',
    features: [
      '10 professional email accounts',
      '100 MB storage per mailbox',
      '5 managed domains',
      'Roundcube Webmail access',
      'IMAP and SMTP client access',
      'Email filtering rules with ManageSieve',
      'Mailing list routing',
      'Aliases, domain aliases and forwarding',
      'Automatic replies and fetched accounts',
      'Full-text search for messages and attachments',
      'DKIM signing',
      'SPF and DMARC guidance',
      'TLS, spam and malware protection',
      'Auto-configuration for email clients',
      'Automatic backups',
      'Renewal reminders and grace-period recovery',
    ],
  },
  {
    id: 'plus',
    name: 'Mail Plus',
    monthly_price: 3.95,
    domain_limit: 15,
    mailbox_limit: 30,
    storage_bytes_per_mailbox: 1024 ** 3,
    overage_per_gb_month: null,
    description: 'More mailboxes and storage for growing businesses.',
    features: [
      '30 professional email accounts',
      '1 GB storage per mailbox',
      '15 managed domains',
      'Roundcube Webmail access',
      'IMAP and SMTP client access',
      'Email filtering rules with ManageSieve',
      'Mailing list routing',
      'Aliases, domain aliases and forwarding',
      'Automatic replies and fetched accounts',
      'Full-text search for messages and attachments',
      'DKIM signing',
      'SPF and DMARC guidance',
      'TLS, spam and malware protection',
      'Auto-configuration for email clients',
      'Automatic backups',
      'Renewal reminders and grace-period recovery',
    ],
  },
  {
    id: 'pro',
    name: 'Mail Pro',
    monthly_price: 5.95,
    domain_limit: 100,
    mailbox_limit: 200,
    storage_bytes_per_mailbox: 5 * 1024 ** 3,
    overage_per_gb_month: null,
    description: 'High-capacity email hosting for organizations.',
    features: [
      '200 professional email accounts',
      '5 GB storage per mailbox',
      '100 managed domains',
      'Roundcube Webmail access',
      'IMAP and SMTP client access',
      'Email filtering rules with ManageSieve',
      'Mailing list routing',
      'Aliases, domain aliases and forwarding',
      'Automatic replies and fetched accounts',
      'Full-text search for messages and attachments',
      'DKIM signing',
      'SPF and DMARC guidance',
      'TLS, spam and malware protection',
      'Auto-configuration for email clients',
      'Automatic backups',
      'Renewal reminders and grace-period recovery',
    ],
  },
  {
    id: 'enterprise',
    name: 'Mail Enterprise',
    monthly_price: 9,
    domain_limit: null,
    mailbox_limit: null,
    storage_bytes_per_mailbox: 10 * 1024 ** 3,
    overage_per_gb_month: 0.005,
    description: 'Unlimited email accounts with metered additional storage.',
    features: [
      'Unlimited professional email accounts',
      '10 GB storage per mailbox',
      '$0.005 per additional GB per month',
      'Unlimited managed domains',
      'Roundcube Webmail access',
      'IMAP and SMTP client access',
      'Email filtering rules with ManageSieve',
      'Mailing list routing',
      'Aliases, domain aliases and forwarding',
      'Automatic replies and fetched accounts',
      'Full-text search for messages and attachments',
      'DKIM signing',
      'SPF and DMARC guidance',
      'TLS, spam and malware protection',
      'Auto-configuration for email clients',
      'Automatic backups',
      'Renewal reminders and grace-period recovery',
    ],
  },
]

export const terms = [
  { months: 1, label: 'Monthly', discount: 0 },
  { months: 3, label: '3 months', discount: 0 },
  { months: 6, label: '6 months', discount: 0 },
  { months: 12, label: '1 year', discount: 10 },
  { months: 24, label: '2 years', discount: 20 },
  { months: 36, label: '3 years', discount: 30 },
]

export function quote(plan, months) {
  const term = terms.find((item) => item.months === Number(months)) ?? terms[0]
  const subtotal = Number(plan.monthly_price) * term.months
  const discountAmount = subtotal * (term.discount / 100)
  return {
    subtotal,
    discountPercent: term.discount,
    discountAmount,
    total: subtotal - discountAmount,
  }
}

export function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value || 0))
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`
  if (value < 1024 ** 3) return `${Math.round(value / 1024 ** 2)} MB`
  return `${Number(value / 1024 ** 3).toFixed(value % 1024 ** 3 === 0 ? 0 : 1)} GB`
}
