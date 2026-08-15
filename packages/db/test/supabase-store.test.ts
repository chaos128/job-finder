import { describe } from 'vitest'
import { createSupabaseStore, type SupabaseStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_SERVICE_KEY

if (url && key) {
  // 이 스위트는 시작할 때마다 __truncateAllForTests()로 모든 행을 지운다.
  // Supabase 프로젝트가 하나뿐이라, 운영 URL을 여기에 넣으면 실제 수집분과
  // 채점 결과가 그대로 날아간다 — 이름이 다르다는 것만 믿지 않고 막는다.
  if (url === process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      'SUPABASE_TEST_URL이 운영 프로젝트(NEXT_PUBLIC_SUPABASE_URL)와 같다. ' +
      '이 계약 테스트는 모든 테이블을 비우므로 실행을 거부한다 — 별도 Supabase 프로젝트를 쓸 것.',
    )
  }

  describeStoreContract(
    'SupabaseStore',
    async () => {
      const store = createSupabaseStore(url, key)
      await store.__truncateAllForTests()
      return store
    },
    (store) => (store as SupabaseStore).__seedSearchForTests(),
  )
} else {
  describe.skip('Store contract: SupabaseStore (SUPABASE_TEST_* 미설정)', () => {})
}
