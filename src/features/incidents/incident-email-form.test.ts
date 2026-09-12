import { expect, it } from 'vitest'
import { emailFormReducer, initialEmailForm } from './incident-email-form'
const draft = { id: 'saved', to: 'saved@example.test', subject: 'Saved subject', includeLogs: true, content: 'Saved body', createdAt: '2026-09-11' }
it('restores all saved fields on a fresh page, including log inclusion', () => {
  expect(emailFormReducer(initialEmailForm('Incident'), { type: 'restore', draft })).toEqual({ to: draft.to, subject: draft.subject, includeLogs: true, edited: false })
})
it.each([{ to: '' }, { subject: 'My edit' }, { includeLogs: false }])('preserves edits when a delayed or refreshed status arrives: %j', (fields) => {
  const restored = emailFormReducer(initialEmailForm('Incident'), { type: 'restore', draft })
  const edited = emailFormReducer(restored, { type: 'edit', fields })
  expect(emailFormReducer(edited, { type: 'restore', draft: { ...draft, to: 'other@example.test', subject: 'Other' } })).toEqual(edited)
})
it('keeps defaults with no saved draft and restores excluded logs correctly', () => {
  const initial = initialEmailForm('Incident')
  expect(emailFormReducer(initial, { type: 'restore', draft: null })).toEqual(initial)
  expect(emailFormReducer(initial, { type: 'restore', draft: { ...draft, includeLogs: false } }).includeLogs).toBe(false)
})
it('marks a successfully prepared form as saved, while later edits remain protected', () => {
  const edited = emailFormReducer(initialEmailForm('Incident'), { type: 'edit', fields: { subject: 'Working' } })
  const saved = emailFormReducer(edited, { type: 'prepared', draft })
  expect(saved.edited).toBe(false)
  const nextEdit = emailFormReducer(saved, { type: 'edit', fields: { to: 'new@example.test' } })
  expect(emailFormReducer(nextEdit, { type: 'restore', draft })).toEqual(nextEdit)
})
