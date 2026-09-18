import { describe, expect, it } from 'vitest'
import { districtLabel } from '@/app/jobs/_components/address'

describe('districtLabel', () => {
  // 아래 값들은 전부 운영 데이터에 실제로 있는 모양이다.
  it('구·시는 그대로 보여준다', () => {
    expect(districtLabel('강남구')).toBe('강남구')
    expect(districtLabel('성남시')).toBe('성남시')
  })

  // Remember가 지역을 특정하지 못한 공고에 넣는 값(123건 중 10건).
  // 그리면 "전체"가 실재하는 지역명처럼 읽힌다.
  it('"전체"는 지역명이 아니라 정보 없음이므로 그리지 않는다', () => {
    expect(districtLabel('전체')).toBeNull()
    expect(districtLabel(' 전체 ')).toBeNull()
  })

  // 0007 이전 수집분이나 상세 조회 전이면 값이 없다.
  it('값이 없으면 null이다', () => {
    expect(districtLabel(null)).toBeNull()
    expect(districtLabel(undefined)).toBeNull()
    expect(districtLabel('  ')).toBeNull()
  })

  // "전체"만 걸러야 한다 — 지역명에 그 글자가 들어가는 것까지 지우면 안 된다.
  it('"전체"가 부분으로 들어간 지역명은 남긴다', () => {
    expect(districtLabel('전체구')).toBe('전체구')
  })
})
