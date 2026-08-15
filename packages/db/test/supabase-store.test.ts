import { describe } from 'vitest'
import { createSupabaseStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_SERVICE_KEY

if (url && key) {
  describeStoreContract('SupabaseStore', async () => {
    const store = createSupabaseStore(url, key)
    await store.__truncateAllForTests()
    return store
  })
} else {
  describe.skip('Store contract: SupabaseStore (SUPABASE_TEST_* 미설정)', () => {})
}
