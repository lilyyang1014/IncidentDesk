import type { EmailDraft } from './incident-email-types'

type Fields = Pick<EmailDraft, 'to' | 'subject' | 'includeLogs'>
export type EmailForm = Fields & { edited: boolean }
type FormAction = { type: 'edit'; fields: Partial<Fields> }
  | { type: 'restore'; draft: EmailDraft | null }
  | { type: 'prepared'; draft: EmailDraft }

export function initialEmailForm(title: string): EmailForm {
  return { to: '', subject: `Incident handoff: ${title}`.slice(0, 160), includeLogs: false, edited: false }
}

export function emailFormReducer(form: EmailForm, action: FormAction): EmailForm {
  if (action.type === 'edit') return { ...form, ...action.fields, edited: true }
  // Status responses may arrive after an edit. Preserve the whole form so
  // recipient, subject and log inclusion always remain the user's selection.
  if (!action.draft || (action.type === 'restore' && form.edited)) return form
  const { to, subject, includeLogs } = action.draft
  return { to, subject, includeLogs, edited: false }
}
