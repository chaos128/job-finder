import { createSupabaseStore, type Store } from '@job-finder/db'

export function getStore(): Store {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  }
  return createSupabaseStore(url, key)
}
