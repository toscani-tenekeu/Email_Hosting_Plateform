import { useEffect, useState } from 'react'
import { Mail, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react'
import { callApi, callMailApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatBytes } from '../lib/pricing'
import { DashboardLayout, EmptyState, PageTitle, StatusBadge } from '../components/DashboardLayout'
import { Notice } from '../components/PublicLayout'
import { useDashboardData } from './useDashboardData'

function MailboxesPage() {
  const data = useDashboardData()
  const activeServices = data.services.filter((item) => ['active', 'provisioning'].includes(item.status))
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ serviceId: '', localPart: '', displayName: '', password: '' })
  const [message, setMessage] = useState('')

  async function create(event) {
    event.preventDefault(); setMessage('')
    try { await callMailApi('create_mailbox', form); setOpen(false); setForm({ serviceId: '', localPart: '', displayName: '', password: '' }); await data.reload() } catch (error) { setMessage(error.message) }
  }
  async function remove(id, email) {
    if (!confirm(`Delete ${email}? Mailbox content may be permanently removed.`)) return
    try { await callMailApi('delete_mailbox', { mailboxId: id }); await data.reload() } catch (error) { alert(error.message) }
  }
  return <DashboardLayout><PageTitle title="Mailboxes" text="Create professional email accounts within each plan limit." action={<button className="button" onClick={() => setOpen(true)} disabled={!activeServices.length}><Plus size={17} /> Create mailbox</button>} />{open && <div className="modal-backdrop"><form className="modal" onSubmit={create}><div className="modal-head"><h2>Create mailbox</h2><button type="button" className="icon-button" onClick={() => setOpen(false)}><X /></button></div><label>Domain<select required value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}><option value="">Select a domain</option>{activeServices.map((item) => <option value={item.id} key={item.id}>{item.domain_name}</option>)}</select></label><label>Address<input required pattern="[A-Za-z0-9._-]+" placeholder="hello" value={form.localPart} onChange={(e) => setForm({ ...form, localPart: e.target.value.toLowerCase() })} /></label><label>Display name<input placeholder="Company Support" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label><label>Temporary password<input required type="password" minLength="10" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><small>The password is sent securely to Mailu and is not stored in plaintext by this platform.</small>{message && <div className="form-message">{message}</div>}<button className="button full">Create mailbox</button></form></div>}<section className="panel table-panel">{data.mailboxes.length ? <div className="responsive-table"><table><thead><tr><th>Email address</th><th>Storage</th><th>Protocols</th><th>Status</th><th></th></tr></thead><tbody>{data.mailboxes.map((mailbox) => <tr key={mailbox.id}><td><b>{mailbox.email}</b><small>{mailbox.display_name || 'No display name'}</small></td><td>{formatBytes(mailbox.used_bytes)} / {formatBytes(mailbox.quota_bytes)}</td><td>IMAP {mailbox.imap_enabled ? 'on' : 'off'} · POP3 {mailbox.pop3_enabled ? 'on' : 'off'}</td><td><StatusBadge value={mailbox.enabled ? 'active' : 'suspended'} /></td><td><button className="icon-button danger" onClick={() => remove(mailbox.id, mailbox.email)} title="Delete mailbox"><Trash2 size={17} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Mail} title="No mailboxes" text="Provision a domain, then create the first professional address." />}</section></DashboardLayout>
}

function DnsPage() {
  const { user } = useAuth()
  const [services, setServices] = useState([])
  const [records, setRecords] = useState([])
  const [selected, setSelected] = useState('')
  async function load() {
    if (!user) return
    const dashboard = await callApi('dashboard')
    const serviceResult = { data: dashboard.services || [] }
    setServices(serviceResult.data)
    const id = selected || serviceResult.data?.[0]?.id || ''
    setSelected(id)
    if (id) {
      const recordResult = await callApi('service_dns', { serviceId: id })
      setRecords(recordResult.records || [])
    }
  }
  useEffect(() => { load() }, [user?.id, selected])
  async function sync() { try { await callMailApi('sync_dns', { serviceId: selected }); await load() } catch (error) { alert(error.message) } }
  return <DashboardLayout><PageTitle title="DNS setup" text="Publish these records at the DNS provider that manages your domain." action={<button className="button secondary" onClick={sync} disabled={!selected}><RefreshCw size={17} /> Refresh from Mailu</button>} /><Notice tone="warning">KmerHosting Email Hosting does not register the domain. DNS changes must be made where your domain nameservers are managed.</Notice><section className="panel"><label className="inline-select">Domain<select value={selected} onChange={(e) => setSelected(e.target.value)}>{services.map((item) => <option key={item.id} value={item.id}>{item.domain_name}</option>)}</select></label>{records.length ? <div className="dns-list">{records.map((record) => <article key={record.id}><div><StatusBadge value={record.status} /><b>{record.record_type}</b></div><span>{record.hostname}</span><code>{record.value}</code>{record.priority != null && <small>Priority: {record.priority}</small>}</article>)}</div> : <EmptyState icon={Server} title="No DNS records available" text="Provision the domain or refresh the Mailu DNS details." />}</section></DashboardLayout>
}

export { MailboxesPage, DnsPage }
