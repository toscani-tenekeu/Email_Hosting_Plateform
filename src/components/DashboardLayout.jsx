import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Bell, CreditCard, Globe2, Inbox, LayoutDashboard, LifeBuoy, LogOut, Mail, Menu, Plus, RefreshCw, Server, Settings, ShieldCheck, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Logo } from './PublicLayout'

function Protected({ children, admin = false }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div className="loading-screen"><RefreshCw className="spin" /> Loading account…</div>
  if (!user) return <Navigate to="/login" replace />
  if (admin && !isAdmin) return <Navigate to="/dashboard" replace />
  return children
}

const dashboardNav = [
  ['/dashboard', LayoutDashboard, 'Overview'],
  ['/dashboard/domains', Globe2, 'Domains'],
  ['/dashboard/mailboxes', Mail, 'Mailboxes'],
  ['/dashboard/dns', Server, 'DNS setup'],
  ['/dashboard/billing', CreditCard, 'Billing'],
  ['/dashboard/notifications', Bell, 'Notifications'],
  ['/dashboard/settings', Settings, 'Settings'],
  ['/dashboard/support', LifeBuoy, 'Support'],
]

function DashboardLayout({ children }) {
  const location = useLocation()
  const { profile, isAdmin, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  return <div className="dashboard-shell"><aside className={open ? 'dashboard-sidebar open' : 'dashboard-sidebar'}><div className="sidebar-head"><Logo /><button className="icon-button mobile-close" onClick={() => setOpen(false)}><X /></button></div><nav>{dashboardNav.map(([path, Icon, label]) => <Link key={path} className={location.pathname === path ? 'active' : ''} to={path} onClick={() => setOpen(false)}><Icon size={18} /> {label}</Link>)}{isAdmin && <Link className={location.pathname.startsWith('/dashboard/admin') ? 'active' : ''} to="/dashboard/admin"><ShieldCheck size={18} /> Administration</Link>}</nav><div className="sidebar-user"><div><b>{profile?.full_name || profile?.email || 'Account'}</b><small>{isAdmin ? 'Administrator' : 'Customer'}</small></div><button className="icon-button" onClick={signOut} title="Sign out"><LogOut size={18} /></button></div></aside><div className="dashboard-main"><header className="dashboard-topbar"><button className="icon-button dash-menu" onClick={() => setOpen(true)}><Menu /></button><div><b>Email Hosting</b><small>Customer control panel</small></div><Link className="button small" to="/checkout">New service <Plus size={16} /></Link></header><main className="dashboard-content">{children}</main></div></div>
}

function PageTitle({ title, text, action }) { return <div className="dashboard-title"><div><h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div> }
function EmptyState({ icon: Icon = Inbox, title, text, action }) { return <div className="empty-state"><Icon /><h3>{title}</h3><p>{text}</p>{action}</div> }
function StatusBadge({ value }) { return <span className={`status-badge ${String(value).replace('_', '-')}`}>{String(value).replace('_', ' ')}</span> }

export { Protected, DashboardLayout, PageTitle, EmptyState, StatusBadge }
