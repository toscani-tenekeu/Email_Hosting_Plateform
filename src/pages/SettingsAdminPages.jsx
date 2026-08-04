import { useEffect, useState } from 'react'
import { Check, Globe2, LifeBuoy, RefreshCw, Users } from 'lucide-react'
import { supportEmail } from '../config'
import { callApi, callMailApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatMoney } from '../lib/pricing'
import { DashboardLayout, PageTitle } from '../components/DashboardLayout'
import { Notice } from '../components/PublicLayout'

function SettingsPage() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({ fullName: profile?.full_name || '', companyName: profile?.company_name || '' })
  const [message, setMessage] = useState('')
  async function save(event) { event.preventDefault(); try { await callApi('update_profile', { fullName: form.fullName, companyName: form.companyName }); setMessage('Profile updated.'); await refreshProfile() } catch (error) { setMessage(error.message) } }
  return <DashboardLayout><PageTitle title="Settings" text="Account details used for service and billing communication." /><form className="panel settings-form" onSubmit={save}><label>Account email<input value={profile?.email || ''} disabled /></label><label>Full name<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label><label>Company name<input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></label>{message && <div className="form-message">{message}</div>}<button className="button">Save changes</button></form></DashboardLayout>
}

function DashboardSupportPage() { return <DashboardLayout><PageTitle title="Support" text="Get help with account credit, DNS, delivery or mailbox access." /><section className="panel support-card"><LifeBuoy size={40} /><h2>Contact the support team</h2><p>For account credit, include the USD amount and your account email. For DNS issues, include the domain and the affected record. Do not send mailbox passwords.</p><a className="button" href={`mailto:${supportEmail}?subject=Email%20Hosting%20Support`}>Email {supportEmail}</a></section></DashboardLayout> }

function AdminPage() {
  const [form, setForm] = useState({ email: '', amount: '', reason: '' })
  const [message, setMessage] = useState('')
  const [stats, setStats] = useState({ users: 0, services: 0, jobs: 0 })
  useEffect(() => { callApi('admin_stats').then(({ stats: next }) => setStats(next)).catch(() => undefined) }, [])
  async function credit(event) { event.preventDefault(); setMessage(''); try { const data = await callApi('admin_credit', { email: form.email, amount: Number(form.amount), reason: form.reason, idempotencyKey: crypto.randomUUID() }); setMessage(`Credited successfully. New balance: ${formatMoney(data.balance)}`); setForm({ email: '', amount: '', reason: '' }) } catch (error) { setMessage(error.message) } }
  async function runAutomation() { try { const result = await callMailApi('run_automation'); setMessage(`Automation processed ${result.processed || 0} job(s).`) } catch (error) { setMessage(error.message) } }
  return <DashboardLayout><PageTitle title="Administration" text="Customer credit and email provisioning operations." action={<button className="button secondary" onClick={runAutomation}><RefreshCw size={17} /> Run automation</button>} /><div className="stats-grid admin-stats"><article><Users /><span>Customers</span><b>{stats.users}</b></article><article><Globe2 /><span>Services</span><b>{stats.services}</b></article><article><RefreshCw /><span>Pending jobs</span><b>{stats.jobs}</b></article></div><div className="dashboard-columns"><form className="panel settings-form" onSubmit={credit}><h2>Credit customer balance</h2><Notice tone="warning">This is a real USD balance mutation. Verify the customer, amount and payment before submitting.</Notice><label>Customer account email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Amount in USD<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label><label>Reason<input required placeholder="Manual credit after verified payment" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>{message && <div className="form-message">{message}</div>}<button className="button">Add USD credit</button></form><section className="panel"><h2>Operational requirements</h2><ul className="check-list"><li><Check /> Server-side mail API at mail.kmerhosting.com</li><li><Check /> Mail and notification credentials stored only in Vault</li><li><Check /> Customer tables isolated with the eh_ prefix</li><li><Check /> Wallet balances cannot be edited by customers</li><li><Check /> Provisioning jobs are idempotent and retryable</li></ul></section></div></DashboardLayout>
}

export { SettingsPage, DashboardSupportPage, AdminPage }
