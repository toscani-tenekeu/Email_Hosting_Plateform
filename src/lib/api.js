const API_PATH = '/api/eh'
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

export async function callApi(action, payload = {}) {
  const response = await fetch(API_PATH, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : {}) },
    body: JSON.stringify({ action, ...payload }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'The request failed.')
  return data
}

export const callMailApi = callApi

export function purchaseService(planId, termMonths, domainName) {
  return callApi('purchase_service', { planId, termMonths: Number(termMonths), domainName })
}
