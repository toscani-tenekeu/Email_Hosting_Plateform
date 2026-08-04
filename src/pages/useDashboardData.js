import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { callApi } from '../lib/api'

function useDashboardData() {
  const { user } = useAuth()
  const [data, setData] = useState({ wallet: null, services: [], invoices: [], notifications: [], mailboxes: [], loading: true })
  async function load() {
    if (!user) return setData((old) => ({ ...old, loading: false }))
    try {
      const result = await callApi('dashboard')
      setData({ wallet: result.wallet, services: result.services || [], invoices: result.invoices || [], notifications: result.notifications || [], mailboxes: result.mailboxes || [], loading: false })
    } catch { setData((old) => ({ ...old, loading: false })) }
  }
  useEffect(() => { load() }, [user?.id])
  return { ...data, reload: load }
}

export { useDashboardData }
