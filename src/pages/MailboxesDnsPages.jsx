import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Eye, EyeOff, KeyRound, Mail, Plus, RefreshCw, Send, Server, Trash2, X } from 'lucide-react'
import { callApi, callMailApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import { webmailUrl } from '../config'
import { formatBytes } from '../lib/pricing'
import { DashboardLayout, EmptyState, PageTitle, StatusBadge } from '../components/DashboardLayout'
import { Notice } from '../components/PublicLayout'
import { useDashboardData } from './useDashboardData'

function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function dnsCsv(records) {
  const rows = [
    ['Record type', 'Hostname', 'Value', 'Priority', 'Status'],
    ...records.map((record) => [record.record_type, record.hostname, record.value, record.priority ?? '', record.status]),
  ]
  return `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\r\n')}\r\n`
}

function fileNameForDomain(domain) {
  return `${String(domain || 'domain').replace(/[^a-z0-9.-]+/gi, '-')}-dns-records.csv`
}

function MailboxesPage() {
  const data = useDashboardData()
  const activeServices = data.services.filter((item) => ['active', 'provisioning'].includes(item.status))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ serviceId: '', localPart: '', displayName: '', password: '' })
  const [message, setMessage] = useState('')
  const [credentialsMailbox, setCredentialsMailbox] = useState(null)
  const [credentialsPassword, setCredentialsPassword] = useState('')
  const [showCredentialsPassword, setShowCredentialsPassword] = useState(false)
  const [credentialsBusy, setCredentialsBusy] = useState(false)
  const [credentialsMessage, setCredentialsMessage] = useState('')

  async function create(event) {
    event.preventDefault(); setMessage('')
    try { await callMailApi('create_mailbox', form); setOpen(false); setForm({ serviceId: '', localPart: '', displayName: '', password: '' }); await data.reload() } catch (error) { setMessage(error.message) }
  }

  async function remove(id, email) {
    if (!confirm(`Delete ${email}? Mailbox content may be permanently removed.`)) return
    try { await callMailApi('delete_mailbox', { mailboxId: id }); await data.reload() } catch (error) { alert(error.message) }
  }

  function openCredentials(mailbox) {
    setCredentialsMailbox(mailbox)
    setCredentialsPassword('')
    setShowCredentialsPassword(false)
    setCredentialsMessage('')
  }

  function closeCredentials() {
    if (credentialsBusy) return
    setCredentialsMailbox(null)
    setCredentialsPassword('')
    setCredentialsMessage('')
  }

  async function changePassword(event) {
    event.preventDefault()
    setCredentialsBusy(true)
    setCredentialsMessage('')
    try {
      await callMailApi('change_mailbox_password', { mailboxId: credentialsMailbox.id, password: credentialsPassword })
      setCredentialsPassword('')
      setShowCredentialsPassword(false)
      setCredentialsMessage('Webmail password changed successfully.')
    } catch (error) {
      setCredentialsMessage(error.message)
    } finally {
      setCredentialsBusy(false)
    }
  }

  return <DashboardLayout>
    <PageTitle title="Mailboxes" text="Create professional email accounts within each plan limit." action={<button className="button" onClick={() => setOpen(true)} disabled={!activeServices.length}><Plus size={17} /> Create mailbox</button>} />
    {open && <div className="modal-backdrop"><form className="modal" onSubmit={create}><div className="modal-head"><h2>Create mailbox</h2><button type="button" className="icon-button" onClick={() => setOpen(false)}><X /></button></div><label>Domain<select required value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}><option value="">Select a domain</option>{activeServices.map((item) => <option value={item.id} key={item.id}>{item.domain_name}</option>)}</select></label><label>Address<input required pattern="[A-Za-z0-9._-]+" placeholder="hello" value={form.localPart} onChange={(e) => setForm({ ...form, localPart: e.target.value.toLowerCase() })} /></label><label>Display name<input placeholder="Company Support" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label><label>Temporary password<input required type="password" minLength="10" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><small>The password is sent securely and is not stored in plaintext by this platform.</small>{message && <div className="form-message">{message}</div>}<button className="button full">Create mailbox</button></form></div>}
    {credentialsMailbox && <div className="modal-backdrop"><form className="modal" onSubmit={changePassword}><div className="modal-head"><h2>Webmail credentials</h2><button type="button" className="icon-button" onClick={closeCredentials} disabled={credentialsBusy}><X /></button></div><label>Webmail URL<input value={webmailUrl} readOnly /></label><label>Username<input value={credentialsMailbox.email} readOnly /></label><label>New password<div className="password-control"><input required minLength="10" maxLength="128" type={showCredentialsPassword ? 'text' : 'password'} value={credentialsPassword} onChange={(e) => setCredentialsPassword(e.target.value)} autoComplete="new-password" /><button type="button" className="icon-button" onClick={() => setShowCredentialsPassword((value) => !value)} title={showCredentialsPassword ? 'Hide password' : 'Show password'} aria-label={showCredentialsPassword ? 'Hide password' : 'Show password'}>{showCredentialsPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><small>The current password cannot be displayed. Set a new password here; it is sent only to the mail service and is never stored by this platform.</small>{credentialsMessage && <div className="form-message">{credentialsMessage}</div>}<button className="button full" disabled={credentialsBusy || credentialsPassword.length < 10}>{credentialsBusy ? 'Changing password…' : 'Change password'}</button></form></div>}
    <section className="panel table-panel"><div className="panel-head"><h2>Your mailboxes</h2><a href={webmailUrl} target="_blank" rel="noreferrer">Open webmail <ExternalLink size={14} /></a></div>{data.mailboxes.length ? <div className="responsive-table"><table><thead><tr><th>Email address</th><th>Storage</th><th>Protocols</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.mailboxes.map((mailbox) => <tr key={mailbox.id}><td><b>{mailbox.email}</b><small>{mailbox.display_name || 'No display name'}</small></td><td>{formatBytes(mailbox.used_bytes)} / {formatBytes(mailbox.quota_bytes)}</td><td>IMAP {mailbox.imap_enabled ? 'on' : 'off'} · POP3 {mailbox.pop3_enabled ? 'on' : 'off'}</td><td><StatusBadge value={mailbox.enabled ? 'active' : 'suspended'} /></td><td><div className="table-actions"><button className="button tiny secondary" onClick={() => openCredentials(mailbox)}><KeyRound size={14} /> Credentials</button>{mailbox.enabled && <a className="button tiny secondary" href={webmailUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Webmail</a>}<button className="icon-button danger" onClick={() => remove(mailbox.id, mailbox.email)} title="Delete mailbox" aria-label={`Delete ${mailbox.email}`}><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={Mail} title="No mailboxes" text="Provision a domain, then create the first professional address." />}</section>
  </DashboardLayout>
}

function DnsPage() {
  const { user } = useAuth()
  const [services, setServices] = useState([])
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState('')
  const [summary, setSummary] = useState({ verifiedCount: 0, totalCount: 0, allVerified: false })
  const [nameserverCheck, setNameserverCheck] = useState({ ok: false, required: ['dane.ns.cloudflare.com', 'olivia.ns.cloudflare.com'], nameservers: [], missing: [] })
  const [checking, setChecking] = useState(false)
  const [sending, setSending] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [message, setMessage] = useState('')

  const loadServices = useCallback(async () => {
    if (!user?.id) return
    try {
      const dashboard = await callApi('dashboard')
      const nextServices = dashboard.services || []
      setServices(nextServices)
      setSelected((current) => current || nextServices[0]?.id || '')
    } catch (error) { setMessage(error.message) }
  }, [user?.id])

  const verify = useCallback(async (serviceId = selected) => {
    if (!serviceId) return
    setChecking(true)
    try {
      const result = await callApi('verify_dns', { serviceId })
      setRecords(result.records || [])
      setSummary(result.summary || { verifiedCount: 0, totalCount: 0, allVerified: false })
      setNameserverCheck(result.nameserverCheck || { ok: false, required: ['dane.ns.cloudflare.com', 'olivia.ns.cloudflare.com'], nameservers: [], missing: [] })
    } catch (error) { setMessage(error.message) } finally { setChecking(false) }
  }, [selected])

  useEffect(() => { loadServices() }, [loadServices])
  useEffect(() => { if (selected) verify(selected) }, [selected, verify])
  useEffect(() => {
    if (!selected || !records.length || (summary.allVerified && nameserverCheck.ok)) return undefined
    const timer = setInterval(() => { if (document.visibilityState === 'visible') verify(selected) }, 15000)
    return () => clearInterval(timer)
  }, [selected, records.length, summary.allVerified, nameserverCheck.ok, verify])

  async function sync() {
    try { await callMailApi('sync_dns', { serviceId: selected }); await verify(selected) } catch (error) { setMessage(error.message) }
  }

  async function copyValue(record) {
    try {
      await navigator.clipboard.writeText(record.value)
      setCopiedId(record.id)
      setTimeout(() => setCopiedId(''), 1800)
    } catch (error) { setMessage(error.message) }
  }

  function download() {
    const domain = services.find((item) => item.id === selected)?.domain_name
    if (!records.length) return
    const blob = new Blob([dnsCsv(records)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = fileNameForDomain(domain); link.click(); URL.revokeObjectURL(url)
  }

  async function sendHelp() {
    if (!selected) return
    setSending(true); setMessage('')
    try {
      const latest = await callApi('verify_dns', { serviceId: selected })
      setRecords(latest.records || [])
      setSummary(latest.summary || { verifiedCount: 0, totalCount: 0, allVerified: false })
      setNameserverCheck(latest.nameserverCheck || nameserverCheck)
      if (!latest.nameserverCheck?.ok) {
        const required = (latest.nameserverCheck?.required || nameserverCheck.required).join(' and ')
        setMessage(`Before requesting support, set these nameservers at your registrar: ${required}.`)
        return
      }
      await callApi('send_dns_help', { serviceId: selected })
      setMessage('Your DNS configuration and CSV have been sent to KmerHosting Support. You will receive an email from the support team.')
    } catch (error) { setMessage(error.message) } finally { setSending(false) }
  }

  const domain = services.find((item) => item.id === selected)?.domain_name || ''
  return <DashboardLayout><PageTitle title="DNS setup" text="Publish these records at the DNS provider that manages your domain." action={<div className="page-actions"><button className="button secondary" onClick={download} disabled={!records.length}><Download size={17} /> Download CSV</button><button className="button" onClick={sendHelp} disabled={!selected || sending || !nameserverCheck.ok}><Send size={17} /> {sending ? 'Sending to Support…' : 'Submit DNS setup to Support'}</button></div>} /><Notice tone={summary.allVerified ? 'success' : 'warning'}>{summary.allVerified ? <><Check size={16} /> All DNS records for {domain} are publicly resolved.</> : <>DNS verification is automatic every 15 seconds while records are unresolved ({summary.verifiedCount}/{summary.totalCount} verified). Need help? Support is free.</>}</Notice><Notice tone={nameserverCheck.ok ? 'success' : 'warning'}>{nameserverCheck.ok ? <><Check size={16} /> Required nameservers are active: {nameserverCheck.required.join(' and ')}.</> : <>Before requesting free support configuration, update your registrar nameservers to <b>{nameserverCheck.required.join(' and ')}</b>. Support requests are accepted only after this delegation is publicly detected.</>}</Notice>{message && <div className="form-message">{message}</div>}<section className="panel"><div className="panel-head"><label className="inline-select">Domain<select value={selected} onChange={(e) => { setSelected(e.target.value); setNameserverCheck({ ok: false, required: ['dane.ns.cloudflare.com', 'olivia.ns.cloudflare.com'], nameservers: [], missing: [] }) }}>{services.map((item) => <option key={item.id} value={item.id}>{item.domain_name}</option>)}</select></label><button className="button secondary" onClick={sync} disabled={!selected || checking}><RefreshCw size={17} className={checking ? 'spin' : ''} /> Refresh DNS records</button></div>{records.length ? <div className="dns-list">{records.map((record) => <article key={record.id}><div><StatusBadge value={record.status} /><b>{record.record_type}</b></div><span>{record.hostname}</span><div className="record-value-row"><code>{record.value}</code><button className="icon-button" onClick={() => copyValue(record)} title="Copy DNS record" aria-label={`Copy ${record.record_type} record`}>{copiedId === record.id ? <Check size={16} /> : <Copy size={16} />}</button></div>{record.priority != null && <small>Priority: {record.priority}</small>}</article>)}</div> : <EmptyState icon={Server} title="No DNS records available" text="Provision the domain or refresh its DNS details." />}</section></DashboardLayout>
}

export { MailboxesPage, DnsPage }
