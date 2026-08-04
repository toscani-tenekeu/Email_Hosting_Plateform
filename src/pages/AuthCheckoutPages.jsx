import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { domainStoreUrl, siteUrl, supportEmail } from '../config'
import { callMailApi, purchaseService } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fallbackPlans, formatBytes, formatMoney, quote, terms } from '../lib/pricing'
import { supabase } from '../lib/supabase'
import { Logo, Notice, PublicLayout } from '../components/PublicLayout'

function AuthPage({ mode }) {
  const { user, configured } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', fullName: '' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/dashboard" replace />

  async function submit(event) {
    event.preventDefault()
    if (!supabase) return setMessage('Supabase environment variables are not configured.')
    setBusy(true); setMessage('')
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.fullName }, emailRedirectTo: `${siteUrl}/dashboard` } })
        if (error) throw error
        setMessage('Account created. Check your email if confirmation is required.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
        if (error) throw error
        navigate('/dashboard')
      }
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }

  return <PublicLayout><section className="auth-section"><form className="auth-card" onSubmit={submit}><Logo /><h1>{mode === 'register' ? 'Create your account' : 'Sign in'}</h1><p>{mode === 'register' ? 'Use an address where you can receive service and renewal notices.' : 'Manage your domains, mailboxes and billing.'}</p>{!configured && <Notice tone="warning">The frontend environment is not configured.</Notice>}{mode === 'register' && <label>Full name<input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>}<label>Email address<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Password<input type="password" minLength="8" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>{message && <div className="form-message">{message}</div>}<button className="button full" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button><small>{mode === 'register' ? <>Already registered? <Link to="/login">Sign in</Link></> : <>New customer? <Link to="/register">Create an account</Link></>}</small></form></section></PublicLayout>
}

function CheckoutPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [planId, setPlanId] = useState(params.get('plan') || 'starter')
  const [term, setTerm] = useState(Number(params.get('term') || 1))
  const [domain, setDomain] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const plan = fallbackPlans.find((item) => item.id === planId) || fallbackPlans[0]
  const pricing = quote(plan, term)

  async function order(event) {
    event.preventDefault()
    if (!user) return navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    setBusy(true); setResult(null)
    try {
      const data = await purchaseService(planId, term, domain)
      setResult(data)
      if (data.status === 'paid') {
        try { await callMailApi('provision_service', { serviceId: data.serviceId }) } catch { /* queued for retry */ }
      }
    } catch (error) { setResult({ status: 'error', error: error.message }) } finally { setBusy(false) }
  }

  return <PublicLayout><section className="page-hero small"><div className="container"><h1>Order email hosting</h1><p>Provide a domain you already own. No domain registration is included.</p></div></section><section className="section"><div className="container checkout-grid"><form className="panel" onSubmit={order}><h2>Service details</h2><label>Plan<select value={planId} onChange={(e) => setPlanId(e.target.value)}>{fallbackPlans.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Billing term<select value={term} onChange={(e) => setTerm(Number(e.target.value))}>{terms.map((item) => <option value={item.months} key={item.months}>{item.label}{item.discount ? ` — ${item.discount}% off` : ''}</option>)}</select></label><label>Your registered domain<input required placeholder="yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value.toLowerCase().trim())} /></label><Notice tone="warning"><b>This order does not include a domain.</b> You must own and control the domain entered above. <a href={domainStoreUrl} target="_blank" rel="noreferrer">Buy a domain first</a> if needed.</Notice><label className="check-row"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required /> <span>I confirm that I own or am authorized to configure this domain and accept the Terms of Service.</span></label><button className="button full" disabled={busy || !accepted}>{busy ? 'Processing…' : user ? `Pay ${formatMoney(pricing.total)} from USD balance` : 'Sign in to continue'}</button>{result?.status === 'requires_credit' && <Notice tone="warning">Your balance is {formatMoney(result.balance)}. You need {formatMoney(result.amountMissing)} more. Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a> to add credit.</Notice>}{result?.status === 'paid' && <Notice tone="success">Order paid. Provisioning has started. <Link to="/dashboard/domains">Open your dashboard</Link>.</Notice>}{result?.status === 'error' && <Notice tone="danger">{result.error}</Notice>}</form><aside className="panel order-summary"><h2>Order summary</h2><div><span>{plan.name}</span><b>{formatMoney(plan.monthly_price)}/month</b></div><div><span>Billing term</span><b>{term} month{term === 1 ? '' : 's'}</b></div><div><span>Subtotal</span><b>{formatMoney(pricing.subtotal)}</b></div><div><span>Discount</span><b>-{formatMoney(pricing.discountAmount)}</b></div><div className="total"><span>Total due now</span><b>{formatMoney(pricing.total)}</b></div><ul><li><Check /> {plan.mailbox_limit ? `${plan.mailbox_limit} email accounts` : 'Unlimited email accounts'}</li><li><Check /> {formatBytes(plan.storage_bytes_per_mailbox)} per mailbox</li><li><Check /> DKIM, forwarding, autoresponders and backups</li></ul></aside></div></section></PublicLayout>
}

export { AuthPage, CheckoutPage }
