import { describe } from 'vitest'
import { createSupabaseStore, type SupabaseStore } from '../src/index.js'
import { describeStoreContract } from './store-contract.js'

const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_SERVICE_KEY

if (url && key) {
  // 이 스위트는 시작할 때마다 __truncateAllForTests()로 모든 행을 지운다.
  // Supabase 프로젝트가 하나뿐이라, 운영 URL을 여기에 넣으면 실제 수집분과
  // 채점 결과가 그대로 날아간다.
  //
  // 아래 URL 비교만으로는 부족하다: vitest는 .env.local을 process.env로 로드하지
  // 않으므로, 같은 셸에 NEXT_PUBLIC_SUPABASE_URL을 함께 export하지 않은 채
  // SUPABASE_TEST_URL만 운영 값으로 주면 undefined와 비교되어 그냥 통과한다.
  // 그래서 "지워도 좋다"는 명시적 옵트인을 별도로 요구한다 — 이건 무엇이
  // 로드됐는지와 무관하게 항상 발동한다.
  if (process.env.SUPABASE_TEST_ALLOW_TRUNCATE !== '1') {
    throw new Error(
      'SUPABASE_TEST_* 가 설정됐지만 SUPABASE_TEST_ALLOW_TRUNCATE=1 이 없다. ' +
      '이 계약 테스트는 대상 프로젝트의 모든 테이블을 비운다 — 지워도 되는 ' +
      '별도 Supabase 프로젝트임을 확인한 뒤 그 변수를 함께 지정할 것.',
    )
  }
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
