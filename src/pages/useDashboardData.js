import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

function useDashboardData() {
  const { user } = useAuth()
  const [data, setData] = useState({ wallet: null, services: [], invoices: [], notifications: [], mailboxes: [], loading: true })
  async function load() {
    if (!supabase || !user) return setData((old) => ({ ...old, loading: false }))
    const [wallet, services, invoices, notifications, mailboxes] = await Promise.all([
      supabase.from('eh_wallets').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('eh_services').select('*, eh_plans(name, monthly_price)').order('created_at', { ascending: false }),
      supabase.from('eh_invoices').select('*').order('issued_at', { ascending: false }).limit(10),
      supabase.from('eh_notifications').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('eh_mailboxes').select('*').order('created_at', { ascending: false }),
    ])
    setData({ wallet: wallet.data, services: services.data || [], invoices: invoices.data || [], notifications: notifications.data || [], mailboxes: mailboxes.data || [], loading: false })
  }
  useEffect(() => { load() }, [user?.id])
  return { ...data, reload: load }
}

export { useDashboardData }
