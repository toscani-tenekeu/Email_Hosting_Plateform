import { Link } from 'react-router-dom'
import { Bell, Globe2, Mail, WalletCards } from 'lucide-react'
import { callMailApi } from '../lib/api'
import { fallbackPlans, formatMoney } from '../lib/pricing'
import { DashboardLayout, EmptyState, PageTitle, StatusBadge } from '../components/DashboardLayout'
import { Notice } from '../components/PublicLayout'
import { useDashboardData } from './useDashboardData'

function DomainCapacity({ services, withPanel = false }) {
  const activeServices = services.filter((service) => service.status !== 'cancelled')
  const content = <div className="domain-capacity-grid" aria-label="Domain capacity by plan">{fallbackPlans.map((plan) => { const used = activeServices.filter((service) => service.plan_id === plan.id).length; const unlimited = plan.domain_limit == null; const reached = !unlimited && used >= plan.domain_limit; return <article className={`domain-capacity-card ${reached ? 'full' : ''}`} key={plan.id}><span>{plan.name}</span><b>{unlimited ? `${used} / Unlimited` : `${used} / ${plan.domain_limit}`}</b><small>{unlimited ? 'No domain limit' : reached ? 'Domain limit reached' : `${plan.domain_limit - used} domain${plan.domain_limit - used === 1 ? '' : 's'} available`}</small></article> })}</div>
  return withPanel ? <section className="panel domain-capacity-panel"><div className="panel-head"><h2>Domain capacity</h2><Link to="/dashboard/domains">Manage domains</Link></div>{content}</section> : content
}

function OverviewPage() {
  const data = useDashboardData()
  const active = data.services.filter((item) => item.status === 'active').length
  const unread = data.notifications.filter((item) => !item.read_at).length
  return <DashboardLayout><PageTitle title="Overview" text="Your email services, account balance and required actions." action={<Link className="button" to="/checkout">Order email hosting</Link>} />{data.loading ? <div className="panel">Loading…</div> : <><div className="stats-grid"><article><WalletCards /><span>USD balance</span><b>{formatMoney(data.wallet?.balance)}</b><small>Contact support to add credit</small></article><article><Globe2 /><span>Email services</span><b>{data.services.length}</b><small>{active} active</small></article><article><Mail /><span>Mailboxes</span><b>{data.mailboxes.length}</b><small>Across all domains</small></article><article><Bell /><span>Unread notices</span><b>{unread}</b><small>Billing and service alerts</small></article></div><DomainCapacity services={data.services} withPanel /><div className="dashboard-columns"><section className="panel"><div className="panel-head"><h2>Services</h2><Link to="/dashboard/domains">View all</Link></div>{data.services.length ? <div className="data-list">{data.services.slice(0, 4).map((service) => <Link to="/dashboard/domains" key={service.id}><span className="list-icon"><Globe2 /></span><div><b>{service.domain_name}</b><small>{service.eh_plans?.name || service.plan_id} · renews {new Date(service.renews_at).toLocaleDateString()}</small></div><StatusBadge value={service.status} /></Link>)}</div> : <EmptyState icon={Globe2} title="No email service yet" text="Order a plan for a domain you already own." action={<Link className="button small" to="/pricing">View plans</Link>} />}</section><section className="panel"><div className="panel-head"><h2>Recent notifications</h2><Link to="/dashboard/notifications">View all</Link></div>{data.notifications.length ? <div className="notification-list">{data.notifications.slice(0, 5).map((item) => <article key={item.id} className={!item.read_at ? 'unread' : ''}><span></span><div><b>{item.title}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div></article>)}</div> : <EmptyState icon={Bell} title="No notifications" text="Service and billing notices will appear here." />}</section></div></>}</DashboardLayout>
}

function DomainsPage() {
  const data = useDashboardData()
  async function retry(serviceId) {
    try { await callMailApi('provision_service', { serviceId }); await data.reload() } catch (error) { alert(error.message) }
  }
  return <DashboardLayout><PageTitle title="Domains" text="Email hosting services connected to customer-owned domains." action={<Link className="button" to="/checkout">Add domain</Link>} /><Notice><b>Domain registration is not provided here.</b> Every listed domain must remain registered and controlled by you.</Notice><DomainCapacity services={data.services} /><section className="panel table-panel">{data.services.length ? <div className="responsive-table"><table><thead><tr><th>Domain</th><th>Plan</th><th>Mailboxes</th><th>Renews</th><th>Status</th><th></th></tr></thead><tbody>{data.services.map((service) => <tr key={service.id}><td><b>{service.domain_name}</b><small>{service.mailu_domain_created ? 'Provisioned' : 'Waiting for provisioning'}</small></td><td>{service.eh_plans?.name || service.plan_id}</td><td>{data.mailboxes.filter((m) => m.service_id === service.id).length} / {service.mailbox_limit ?? 'Unlimited'}</td><td>{new Date(service.renews_at).toLocaleDateString()}</td><td><StatusBadge value={service.status} /></td><td>{!service.mailu_domain_created && <button className="button tiny secondary" onClick={() => retry(service.id)}>Retry</button>}</td></tr>)}</tbody></table></div> : <EmptyState icon={Globe2} title="No domains" text="Order email hosting for a domain you already own." action={<Link className="button" to="/checkout">Order service</Link>} />}</section></DashboardLayout>
}

export { OverviewPage, DomainsPage }
