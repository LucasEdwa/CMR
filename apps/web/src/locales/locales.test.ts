import { describe, expect, it } from 'vitest'
import sv from './sv.json'
import en from './en.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('translations', () => {
  it('Swedish and English have exactly the same keys', () => {
    expect(keys(sv).sort()).toEqual(keys(en).sort())
  })

  it('no translation is empty', () => {
    for (const [lang, dict] of Object.entries({ sv, en })) {
      const empty = keys(dict).filter((k) => !k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], dict))
      expect(empty, `${lang} has empty strings`).toEqual([])
    }
  })
})
