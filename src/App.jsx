import { Link, Route, Routes } from 'react-router-dom'
import { PublicLayout } from './components/PublicLayout'
import { Protected } from './components/DashboardLayout'
import { HomePage } from './pages/HomePage'
import { PricingPage } from './pages/PricingPages'
import { FeaturesPage, HowItWorksPage, SupportPage, LegalPage } from './pages/InfoPages'
import { AuthPage, CheckoutPage } from './pages/AuthCheckoutPages'
import { OverviewPage, DomainsPage } from './pages/OverviewDomainsPages'
import { MailboxesPage, DnsPage } from './pages/MailboxesDnsPages'
import { BillingPage, NotificationsPage } from './pages/BillingNotificationsPages'
import { SettingsPage, DashboardSupportPage, AdminPage } from './pages/SettingsAdminPages'

function NotFound() { return <PublicLayout><section className="page-hero"><div className="container"><h1>Page not found</h1><Link className="button" to="/">Return home</Link></div></section></PublicLayout> }

export default function App() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/features" element={<FeaturesPage />} />
    <Route path="/pricing" element={<PricingPage />} />
    <Route path="/how-it-works" element={<HowItWorksPage />} />
    <Route path="/support" element={<SupportPage />} />
    <Route path="/privacy" element={<LegalPage type="privacy" />} />
    <Route path="/terms" element={<LegalPage type="terms" />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/checkout" element={<CheckoutPage />} />
    <Route path="/dashboard" element={<Protected><OverviewPage /></Protected>} />
    <Route path="/dashboard/domains" element={<Protected><DomainsPage /></Protected>} />
    <Route path="/dashboard/mailboxes" element={<Protected><MailboxesPage /></Protected>} />
    <Route path="/dashboard/dns" element={<Protected><DnsPage /></Protected>} />
    <Route path="/dashboard/billing" element={<Protected><BillingPage /></Protected>} />
    <Route path="/dashboard/notifications" element={<Protected><NotificationsPage /></Protected>} />
    <Route path="/dashboard/settings" element={<Protected><SettingsPage /></Protected>} />
    <Route path="/dashboard/support" element={<Protected><DashboardSupportPage /></Protected>} />
    <Route path="/dashboard/admin" element={<Protected admin><AdminPage /></Protected>} />
    <Route path="*" element={<NotFound />} />
  </Routes>
}
