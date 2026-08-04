import { supabase } from './supabase'

export async function callMailApi(action, payload = {}) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('eh-mail-api', {
    body: { action, ...payload },
  })
  if (error) throw error
  if (!data?.ok) throw new Error(data?.error || 'The email operation failed.')
  return data
}

export async function purchaseService(planId, termMonths, domainName) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('eh_purchase_service', {
    p_plan_id: planId,
    p_term_months: Number(termMonths),
    p_domain_name: domainName,
  })
  if (error) throw error
  return data
}
