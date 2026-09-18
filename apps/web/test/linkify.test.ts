import { describe, expect, it } from 'vitest'
import { linkify } from '@/lib/linkify'

const links = (t: string) => linkify(t).filter((p) => p.type === 'link')
const texts = (t: string) => linkify(t).filter((p) => p.type === 'text').map((p) => p.value)

describe('linkify', () => {
  it('URL이 없으면 통째로 한 조각이다', () => {
    expect(linkify('복지: 자유로운 연차')).toEqual([{ type: 'text', value: '복지: 자유로운 연차' }])
  })

  it('문장 안의 URL을 호스트 라벨로 끊어 낸다', () => {
    expect(linkify('회사 소개 https://www.saelin.ai 입니다')).toEqual([
      { type: 'text', value: '회사 소개 ' },
      { type: 'link', href: 'https://www.saelin.ai', label: 'saelin.ai' },
      { type: 'text', value: ' 입니다' },
    ])
  })

  // 아래 넷은 전부 운영 데이터에 실제로 있는 모양이다.
  it('꼬리의 닫는 괄호를 링크에 넣지 않는다', () => {
    expect(links('(https://career.crossenf.com)')[0]).toMatchObject({
      href: 'https://career.crossenf.com',
    })
    expect(links('(https://www.enerdot.co.kr/)')[0]).toMatchObject({
      href: 'https://www.enerdot.co.kr/',
    })
  })

  it('꼬리의 대괄호도 떼어 낸다', () => {
    expect(links('[http://toonkit.io]')[0]).toMatchObject({ href: 'http://toonkit.io' })
  })

  // `[^\s]+`로 잡으면 조사까지 주소에 들어가 링크가 깨진다.
  it('URL 뒤에 붙은 한글 조사를 주소에 넣지 않는다', () => {
    const t = '영상(https://www.youtube.com/watch?v=-lfbBvxpkPU)과 함께'
    expect(links(t)[0]).toMatchObject({
      href: 'https://www.youtube.com/watch?v=-lfbBvxpkPU',
      label: 'youtube.com',
    })
    expect(texts(t).join('')).toBe('영상()과 함께')
  })

  // 괄호가 주소의 일부인 URL을 깨면 안 된다 — 닫는 괄호가 더 많을 때만 뗀다.
  it('주소 안에서 짝이 맞는 괄호는 남긴다', () => {
    expect(links('https://ko.wikipedia.org/wiki/React_(라이브러리)')[0]).toMatchObject({
      href: 'https://ko.wikipedia.org/wiki/React_(라이브러리)',
    })
  })

  // 운영 데이터에 실재하는, 경로에 한글이 들어간 정상 주소. 조사와 구분해야 한다.
  it('경로 한가운데의 한글은 주소의 일부로 남긴다', () => {
    expect(links('https://apps.apple.com/kr/app/데일리샷-dailyshot/id1286370741')[0])
      .toMatchObject({ href: 'https://apps.apple.com/kr/app/데일리샷-dailyshot/id1286370741' })
    expect(links('(https://tech.remember.co.kr/개발자가-개발을-안하는-세계에서-b13f1a0114ba)')[0])
      .toMatchObject({ href: 'https://tech.remember.co.kr/개발자가-개발을-안하는-세계에서-b13f1a0114ba' })
  })

  it('한 문단에 여러 개도 각각 끊는다', () => {
    expect(links('a https://bit.ly/3yEZh18 b https://channel.io/ko c').map((p) => p.label))
      .toEqual(['bit.ly', 'channel.io'])
  })

  // http/https만 링크로 만든다 — 본문은 외부에서 온 문자열이다.
  it('javascript: 같은 다른 스킴은 링크로 만들지 않는다', () => {
    expect(links('javascript:alert(1) 그리고 mailto:a@b.c')).toEqual([])
  })
})
