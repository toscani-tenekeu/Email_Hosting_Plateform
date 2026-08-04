import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, Mail, Menu, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supportEmail } from '../config'

function Logo() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark"><Mail size={20} /></span>
      <span>KmerHosting <b>Email</b></span>
    </Link>
  )
}

function PublicHeader() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <header className="public-header">
      <div className="container header-inner">
        <Logo />
        <button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label="Open navigation">
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'public-nav open' : 'public-nav'}>
          <Link to="/features" onClick={() => setOpen(false)}>Features</Link>
          <Link to="/pricing" onClick={() => setOpen(false)}>Pricing</Link>
          <Link to="/how-it-works" onClick={() => setOpen(false)}>How it works</Link>
          <Link to="/support" onClick={() => setOpen(false)}>Support</Link>
          {user ? (
            <Link className="button small" to="/dashboard">Dashboard</Link>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="button small" to="/register">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

function PublicFooter() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <p>Professional email hosting on domains you already own.</p>
          <small>From KmerHosting LLC.</small>
        </div>
        <div>
          <h4>Service</h4>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/how-it-works">Setup</Link>
          <a href="https://status.kmerhosting.com" target="_blank" rel="noreferrer">Status</a>
        </div>
        <div>
          <h4>Company</h4>
          <Link to="/support">Support</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </div>
      </div>
      <div className="container footer-bottom">© 2026 KmerHosting LLC. All prices are in USD.</div>
    </footer>
  )
}

function PublicLayout({ children }) {
  return <><PublicHeader /><main>{children}</main><PublicFooter /></>
}

function Notice({ children, tone = 'info' }) {
  return <div className={`notice ${tone}`}><CircleAlert size={18} /> <div>{children}</div></div>
}

export { Logo, PublicHeader, PublicFooter, PublicLayout, Notice }
