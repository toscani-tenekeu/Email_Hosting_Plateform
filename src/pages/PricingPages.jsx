import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { fallbackPlans, formatMoney, quote, terms } from '../lib/pricing'
import { PublicLayout } from '../components/PublicLayout'

function PricingSection({ compact = false }) {
  const [selectedTerm, setSelectedTerm] = useState(1)
  return (
    <section className={`section pricing-section ${compact ? 'compact-pricing' : ''}`}>
      <div className="container">
        <div className="section-heading"><span>Pricing</span><h2>Four plans. One straightforward email platform.</h2><p>No domain is included. Every plan requires a domain you already own.</p></div>
        <div className="term-picker">
          {terms.map((term) => <button key={term.months} className={selectedTerm === term.months ? 'active' : ''} onClick={() => setSelectedTerm(term.months)}>{term.label}{term.discount > 0 && <small>{term.discount}% off</small>}</button>)}
        </div>
        <div className="pricing-grid">
          {fallbackPlans.map((plan) => <PlanCard key={plan.id} plan={plan} months={selectedTerm} />)}
        </div>
      </div>
    </section>
  )
}

function PlanCard({ plan, months }) {
  const pricing = quote(plan, months)
  return (
    <article className={`plan-card ${plan.id === 'plus' ? 'featured' : ''}`}>
      {plan.id === 'plus' && <div className="popular">Popular</div>}
      <h3>{plan.name}</h3>
      <p>{plan.description}</p>
      <div className="price"><b>{formatMoney(plan.monthly_price)}</b><span>/month</span></div>
      <div className="term-total">{formatMoney(pricing.total)} billed for {months === 1 ? '1 month' : `${months} months`}{pricing.discountPercent > 0 && <small>You save {formatMoney(pricing.discountAmount)}</small>}</div>
      <Link className="button full" to={`/checkout?plan=${plan.id}&term=${months}`}>Choose {plan.name}</Link>
      <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} /> {feature}</li>)}</ul>
    </article>
  )
}

function PricingPage() { return <PublicLayout><PricingSection /></PublicLayout> }

export { PricingSection, PricingPage }
