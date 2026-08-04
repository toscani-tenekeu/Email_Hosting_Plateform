import { Link } from 'react-router-dom'
import { ArrowRight, Bell, CircleAlert, Database, ExternalLink, Inbox, LockKeyhole, Mail, RefreshCw, ShieldCheck, Users, WalletCards } from 'lucide-react'
import { domainStoreUrl } from '../config'
import { PublicLayout } from '../components/PublicLayout'
import { PricingSection } from './PricingPages'

function HomePage() {
  return (
    <PublicLayout>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">Business email on your domain</div>
            <h1>Professional email hosting without the workspace complexity.</h1>
            <p className="lead">Create secure mailboxes, aliases, forwarding rules and automatic replies for a domain you already own. Billing and renewals run from your prepaid USD balance.</p>
            <div className="hero-actions">
              <Link className="button" to="/pricing">View plans <ArrowRight size={18} /></Link>
              <Link className="button secondary" to="/how-it-works">See how setup works</Link>
            </div>
            <p className="hero-note"><CircleAlert size={16} /> Domain registration is not included. You must own a domain before ordering.</p>
          </div>
          <div className="mail-preview">
            <div className="mail-preview-head"><span></span><span></span><span></span></div>
            <div className="mail-preview-body">
              <div className="preview-sidebar">
                <b>example.com</b>
                <span className="active"><Inbox size={16} /> Inbox</span>
                <span><Mail size={16} /> Sent</span>
                <span><ShieldCheck size={16} /> Spam</span>
              </div>
              <div className="preview-content">
                <div className="preview-title">Your business inbox</div>
                <div className="preview-row"><span className="avatar">S</span><div><b>Sales enquiry</b><small>New request from your website</small></div><time>09:42</time></div>
                <div className="preview-row"><span className="avatar">B</span><div><b>Billing confirmation</b><small>Your service renewed successfully</small></div><time>08:17</time></div>
                <div className="preview-row"><span className="avatar">T</span><div><b>Team update</b><small>Shared from operations@example.com</small></div><time>Yesterday</time></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section compact">
        <div className="container trust-row">
          <span><ShieldCheck /> DKIM signing</span>
          <span><LockKeyhole /> Encrypted connections</span>
          <span><Database /> Automatic backups</span>
          <span><RefreshCw /> Automated renewals</span>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-heading"><span>Simple operations</span><h2>Everything required to run company email.</h2><p>The platform manages the commercial lifecycle while the managed mail service handles delivery and mailbox access.</p></div>
          <div className="feature-grid">
            {[
              [Users, 'Mailbox management', 'Create, suspend and remove professional accounts within your plan limits.'],
              [ShieldCheck, 'Domain authentication', 'DKIM is generated for your domain, with clear SPF and DMARC setup guidance.'],
              [ArrowRight, 'Aliases and forwarding', 'Route role addresses such as sales@ and support@ to the right mailbox.'],
              [Bell, 'Renewal reminders', 'Receive reminders before renewal and automatic notifications when credit is insufficient.'],
              [Database, 'Automatic backups', 'Mailbox data is protected by the configured backup policy.'],
              [WalletCards, 'Prepaid USD billing', 'Orders and renewals are deducted from your account balance. Credit is added by support.'],
            ].map(([Icon, title, text]) => <article className="feature-card" key={title}><Icon /><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <PricingSection compact />

      <section className="section dark-section">
        <div className="container steps-grid">
          <div><span className="eyebrow light">Before you order</span><h2>You provide the domain. We provide the email hosting.</h2><p>Use a domain purchased from any registrar. If you do not have one, buy it first and return when it is ready.</p><a className="button light" href={domainStoreUrl} target="_blank" rel="noreferrer">Buy a domain <ExternalLink size={17} /></a></div>
          <ol className="steps">
            <li><span>1</span><div><b>Own a domain</b><p>Example: yourcompany.com</p></div></li>
            <li><span>2</span><div><b>Choose a plan</b><p>Select the mailbox count, storage and billing term.</p></div></li>
            <li><span>3</span><div><b>Pay from account credit</b><p>Contact support if your USD balance needs to be credited.</p></div></li>
            <li><span>4</span><div><b>Publish the DNS records</b><p>Follow the dashboard instructions or contact support for assistance.</p></div></li>
          </ol>
        </div>
      </section>
    </PublicLayout>
  )
}

export { HomePage }
