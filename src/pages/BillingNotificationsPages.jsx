import { useEffect, useState } from 'react'
import { Bell, CreditCard, WalletCards } from 'lucide-react'
import { supportEmail } from '../config'
import { useAuth } from '../lib/auth'
import { callApi } from '../lib/api'
import { formatMoney } from '../lib/pricing'
import { DashboardLayout, EmptyState, PageTitle } from '../components/DashboardLayout'
import { useDashboardData } from './useDashboardData'

function BillingPage() {
  const data = useDashboardData()
  const { user } = useAuth()
  const [transactions, setTransactions] = useState([])
  useEffect(() => { if (user) callApi('wallet_transactions').then(({ transactions }) => setTransactions(transactions || [])).catch(() => setTransactions([])) }, [user?.id])
  return <DashboardLayout><PageTitle title="Billing" text="Prepaid USD balance, invoices and renewal activity." action={<a className="button" href={`mailto:${supportEmail}?subject=Email%20Hosting%20USD%20Credit%20Request`}>Request account credit</a>} /><div className="billing-balance"><div><WalletCards /><span>Available balance</span><b>{formatMoney(data.wallet?.balance)}</b></div><p>There is no public payment gateway. KmerHosting support manually credits your account in USD after completing the applicable payment process.</p></div><div className="dashboard-columns"><section className="panel"><div className="panel-head"><h2>Invoices</h2></div>{data.invoices.length ? <div className="data-list compact-list">{data.invoices.map((invoice) => <article key={invoice.id}><div><b>{invoice.invoice_number}</b><small>{invoice.description}</small></div><div className="right"><b>{formatMoney(invoice.total_amount)}</b><small>{new Date(invoice.issued_at).toLocaleDateString()}</small></div></article>)}</div> : <EmptyState icon={CreditCard} title="No invoices" text="Paid orders and renewals will appear here." />}</section><section className="panel"><div className="panel-head"><h2>Balance history</h2></div>{transactions.length ? <div className="data-list compact-list">{transactions.map((tx) => <article key={tx.id}><div><b>{tx.reason}</b><small>{new Date(tx.created_at).toLocaleString()}</small></div><div className={`right amount ${tx.transaction_type}`}>{tx.transaction_type === 'debit' ? '-' : '+'}{formatMoney(tx.amount)}<small>Balance {formatMoney(tx.balance_after)}</small></div></article>)}</div> : <EmptyState icon={WalletCards} title="No transactions" text="Credits, charges and refunds will appear here." />}</section></div></DashboardLayout>
}

function NotificationsPage() {
  const data = useDashboardData()
  async function markRead(id) { await callApi('mark_notification_read', { id }); await data.reload() }
  return <DashboardLayout><PageTitle title="Notifications" text="Billing reminders, provisioning updates and service alerts." /><section className="panel notification-list full-list">{data.notifications.length ? data.notifications.map((item) => <article key={item.id} className={!item.read_at ? 'unread' : ''} onClick={() => !item.read_at && markRead(item.id)}><span></span><div><b>{item.title}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()}</small></div>{!item.read_at && <button className="button tiny secondary">Mark read</button>}</article>) : <EmptyState icon={Bell} title="No notifications" text="Nothing requires your attention." />}</section></DashboardLayout>
}

export { BillingPage, NotificationsPage }
