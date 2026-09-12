# Gmail incident handoff

The user confirmed the handoff email appeared in both Sent and the recipient inbox. This is user-reported successful sending and receipt; not all manual branches below have been individually confirmed. No real Gmail send or Google consent flow was performed by the agent. Gmail was chosen to complete the workflow without configuring a separate sender domain.

## User flow

1. **Gmail connection** reads existing account/sending-scope status only. Recorded permission is not proof of live token validity.
2. Enter one recipient and a subject in **Email handoff**. Full original logs are excluded by default; AI evidence can still contain log excerpts.
3. **Prepare email draft** reads existing AI and Exa status on the server, builds a plain-text report and saves an immutable draft. It does not call a provider. Missing completed results are stated explicitly.
4. **Review and send email** displays the saved recipient, subject and full body. On page load, the saved recipient, subject and include-logs selection fill the form. Status refreshes preserve the entire form after any field is edited. Successfully preparing a matching draft marks those fields as saved. Form edits do not change the saved draft until another draft is prepared. **Cancel** sends nothing.
5. **Confirm send email** can immediately invoke Gmail and consume DeepSpace credits. If the platform returns `requiresOAuth`, the app instead shows **Authorize Google**. Open it, authorize, return and explicitly review/confirm again. No popup-completion callback or background polling resubmits a send. Wait at least one minute between attempts.
6. **Check email status** restores the latest draft and receipt for the current app user/incident. `accepted` means Gmail returned a message ID, not that the recipient received/read it. Check Gmail Sent and the recipient inbox for actual delivery.

## Data and authorization

`incidentEmail` is an authenticated action routed to private `AppIncidentEmailRoom` SQLite storage. Prepare/status/send all check app membership and incident creator/admin access. Only the app user who prepared the draft may send or retrieve it through their latest-draft pointer; an admin cannot send someone else's draft. The caller JWT selects the connected Gmail identity and billing account; the app never forwards the owner JWT for sending.

Prepare reads the AI room with `intent: status` and references with the read-only `intent: report` to select the latest successful search, rechecks incident access/content and persists the exact server-built body. A draft ID hashes the app user, incident source version, recipient, subject, full body and include-logs selection. Re-preparing identical content reuses its receipt, including prior acceptance/unknown states. Changed recipient/content creates a distinct draft that may be sent separately. A changed incident prevents sending an older draft. AI/reference results are frozen at preparation, not silently regenerated at send time. Reads are not an atomic database snapshot; the displayed frozen email is the reviewed content.

Only `draftId` plus `confirmed: true` is accepted for send. No client-supplied body, sender override, CC/BCC or HTML is accepted. The generic `google/gmail-send` browser/action proxy is blocked so this application path cannot bypass draft checks. Google is not enabled in the generic integration allowlist: browser and action-tool provider calls are rejected before forwarding. Gmail status uses its separate authenticated read route, and the private saved-draft sender calls the fixed Gmail endpoint with the caller JWT. The existing authenticated OAuth-disconnect route remains available; this change does not revoke existing Google consent or narrow its scopes.

## Receipts and limitations

The room transactionally claims a draft before calling Gmail. Concurrent duplicates receive the existing receipt. Accepted and unknown outcomes cannot be resent with that draft ID. A running receipt older than 150 seconds appears unknown. If saving the final outcome fails, the original running receipt remains; automatic resubmission is blocked. This is local application deduplication, not provider-level exactly-once delivery.

Limits: ten provider requests per app user per UTC day, one-minute spacing, three non-OAuth attempts per draft. Confirmed OAuth-required responses are counted separately and release the reserved draft send attempt; they still consume the daily request quota and cooldown. Rejected and uncertain attempts retain the send reservation. Legacy receipts can recover only their last confirmed OAuth attempt, once; earlier attempts remain counted because their outcomes were not stored separately. Failed final persistence never refunds an attempt or unlocks a pending receipt. Known rejected attempts and OAuth-required drafts can be tried again only through another user confirmation. Unknown outcomes, 5xx, transport errors and malformed/unfamiliar success responses block retries. The documented token-refresh-failure HTTP 502 also remains unknown; check Gmail Sent and account authorization rather than blindly resending. Automated reconnect/disconnect and manual receipt reconciliation are not implemented.

The current catalog lists `google/gmail-send` at $0.013 per request and no curated output schema. The adapter accepts the documented OAuth envelope or the standard Gmail message `{ id }` shape. One real send/receipt case is user-confirmed; exact cost and other response variants remain unverified. Authorization links must be HTTPS on `accounts.google.com`; unfamiliar links fail closed pending investigation. The platform requests `gmail.modify`, broader than send-only. Connecting Google is separate from signing into IncidentDesk.

Drafts and receipts are stored privately per app. Retention cleanup, history browsing, expiry, editing the full body, sender-account locking, delivery webhooks, attachments and persisted approval workflows are not implemented. Sending uses whichever Gmail is connected to the calling app account at invocation. Preparing a changed draft may duplicate a prior email; unknown outcomes require manual investigation first. Local and deployed storage are separate.

## Manual acceptance

Start with non-sensitive fictional incident data and restart the local development service for migration `v4-incident-email`.

1. Enter a recipient you control and prepare a draft. Check that full logs are omitted unless selected, while evidence excerpts remain clearly visible. No provider call should occur.
2. Review the exact recipient, subject and body; cancel. Verify no Gmail call. Change the form and prepare again; the newly reviewed draft must show the updated values.
3. Only when explicitly willing to send and consume credits, confirm. A disconnected account should show an authorization link. Grant consent manually, return and check Gmail status; authorization alone must not send the pending draft.
4. Review and confirm again after the cooldown. If accepted, check Gmail Sent and the recipient inbox. The UI must not claim delivery merely from acceptance. A repeated click or reopening the same draft must not send it again.
5. Refresh the incident and check email status. The saved draft/outcome should recover. Another app account cannot access or send your draft. A changed incident must require preparing/reviewing again.

Automated validation mocks every provider/consent response. `scripts/verify-incident-email.mjs` runs the built Worker with real local JWT checks, RecordRoom and all three private rooms in isolated temporary storage, with external networking disabled. It verifies exact saved-body sending, no provider call during preparation/status, explicit confirmation, cross-user refusal, concurrent deduplication, restart recovery and generic-proxy denial. No live credentials or actual recipients are used by the script.

Implementation validation: 195 tests across 20 files, type-check, lint, production build and diff checks passed. The isolated email runtime script passed with one simulated Gmail call and zero external calls. Build secret cleanup was verified. The user subsequently confirmed a real send and receipt. OAuth recovery, cancellation and fault branches have not all been individually confirmed by the user.

OAuth counter fix (committed as `35b9407`, not deployed): 199 tests across 20 files, TypeScript, ESLint and diff checks passed, including four OAuth cycles followed by one accepted send, daily quota preservation across drafts, conservative legacy recovery and failed OAuth-outcome persistence. Existing tests retain concurrency, cooldown, failed-attempt limits and unknown/accepted deduplication coverage. All provider responses in these tests are simulated; no live OAuth or mail acceptance was repeated.

Generic Google access restriction: 213 unit tests across 20 files, TypeScript, ESLint and diff checks passed with mocked service responses. Checks cover denial at both generic entry points, caller-authenticated status reads, and the existing saved-draft send/OAuth behavior. No live provider request, consent change or deployment was performed.

User acceptance of the generic Google restriction: the user confirmed the local browser probe returned HTTP 403 with code `integration_not_enabled` and the expected rejection message. Authenticated browser/action forwarding denial and preservation of private sending/OAuth behavior remain covered by mocked tests; no new real email was sent for this fix.

Email form restoration: reducer tests cover saved-field restoration, absent drafts, included/excluded logs, edits preserved across status responses and successful preparation. TypeScript, ESLint, diff checks and 219 tests across 21 files passed. The user confirmed saved fields restore after reload, status checks preserve edited subject/log selection, and preparing again persists those changes across reload; no provider calls are needed to prepare, review, cancel or refresh status. Unsaved edits still do not survive a full page reload.
