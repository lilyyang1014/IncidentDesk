import { expect, it } from 'vitest'
import { encodeEmailSubject } from './incident-email-subject'

function decodeWords(value: string) {
  return value.split(' ').map(word => {
    expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(word.length).toBeLessThanOrEqual(75)
    const bytes = Uint8Array.from(atob(word.slice(10, -2)), c => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }).join('')
}
it.each([
  'Incident handoff: Production list acceptance — fictional',
  'Incident handoff: 中文测试 — café ✅',
  '🚨'.repeat(80),
  '测'.repeat(160),
  'Before ' + 'a'.repeat(30) + '👩🏽‍💻 after',
  'Literal =?UTF-8?B?YWJj?= text',
])('preserves the exact reviewed subject through ASCII transport: %s', subject => {
  const encoded = encodeEmailSubject(subject)
  expect(encoded).toMatch(/^[\x00-\x7f]+$/)
  expect(decodeWords(encoded)).toBe(subject)
  expect(encoded).not.toMatch(/[\r\n]/)
  expect(`Subject: ${encoded}`.length).toBeLessThanOrEqual(998)
})
it('uses the known UTF-8 bytes for an em dash', () => {
  expect(encodeEmailSubject('—')).toBe('=?UTF-8?B?4oCU?=')
})
it('leaves ordinary ASCII subjects unchanged', () => {
  expect(encodeEmailSubject('Incident handoff: Test - fictional')).toBe('Incident handoff: Test - fictional')
})
it('rejects user-provided header newlines', () => {
  expect(() => encodeEmailSubject('Test\r\nBcc: someone@example.test')).toThrow()
})
