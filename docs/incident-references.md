# Incident troubleshooting references

The user confirmed manual checks 1–4 passed, supplied five real Exa results and observed the invocation in the DeepSpace dashboard. Exact cost was not supplied. The agent performed no real Exa search during implementation.

## Behavior

The incident detail shows **Troubleshooting references** below AI analysis. Enter a 3–300 character query and select **Search references**. Only the trimmed query is sent to DeepSpace's `exa/search` integration; incident logs, title and AI output are not sent. The caller's DeepSpace account pays. Clicking **Search references** opens a confirmation dialog showing a snapshot of the trimmed query and a credits notice. **Cancel**, Escape and closing the dialog do not search. Only **Confirm search** submits that displayed query; the existing request gate prevents repeated confirmation from submitting overlapping requests. The generic integration proxy still rejects Exa.

At most five results are requested, with plain-text extraction limited to 1,500 characters per page. The app displays a title, source hostname, external link and excerpt when available. Results are reference material for human review, not verified fixes. Provider-generated summaries, additional OpenAI calls and automatic searches are not part of this feature.

## Server flow and recovery

`findIncidentReferences` forwards the authenticated request to a separate private SQLite-backed `AppIncidentReferenceRoom`. The room verifies identity, membership and creator/admin access, reads the saved incident and checks access and unchanged input again before responding. Saved title/log bounds match the AI action (120/20,000 characters).

Receipts are keyed by incident identity, saved title/log content and trimmed, case-sensitive query. One transactional claim allows at most one simultaneous provider call for the same input across accounts/devices. Results, including empty results, are reused. The latest submitted query for that incident version is restored on opening the detail. Explicit status reads can retrieve another known query. There is no search-history browser.

Search limits are separate from AI limits: ten attempted requests per caller per UTC day, at least one minute apart, and three attempts per incident/query after known failures. Unknown outcomes (including malformed successful responses) block resubmission for that input. After 150 seconds an unfinished receipt displays unknown. There is no automatic retry, background continuation or manual reset operation.

**Check search status**, opening a detail and refreshing do not invoke Exa. If a request disconnects, check status before attempting another search. Changing the query or incident creates a different input identity and may incur another charge. This is a request-count limit, not a monetary budget.

Results accept only HTTP(S) URLs without embedded credentials. Titles/excerpts render as escaped text; links use `noopener noreferrer`. The app does not fetch the links itself or guarantee external source quality, availability or safety. Old search results are retained privately; cleanup, history selection and cross-tab live broadcasts are deferred. The latest query is shared among authorized viewers of the same incident version, not a per-user preference.

## Verification

Use the supported Node runtime. Run `npm run test:unit`, `npm run type-check`, `npm run lint`, `npm run build`, then `node scripts/verify-incident-references.mjs`.

The runtime script runs the actual built Worker and RecordRoom with temporary storage and ephemeral test credentials. The Exa service boundary is mocked and outbound network is disabled. It checks access denial, concurrent deduplication, query/result persistence after restarting the runtime and cached reuse. Unit tests cover malformed/unsafe output, caller identity, fixed request limits, quota/cooldown, unknown outcomes, changed incident/access and escaped rendering. At implementation time, 161 tests across 15 files, type-check, lint and production build passed. Both Exa and OpenAI isolated runtime scripts passed, with one simulated provider call each and zero external calls. Temporary build `.dev.vars` cleanup was verified. The user subsequently confirmed manual/live acceptance; returned excerpts included third-party material and one redirect-only result. Source quality is not guaranteed. These checks do not establish real Exa result quality or billing.

## Manual acceptance

1. Restart the local development service for the new Durable Object binding. Open an existing incident and confirm the reference section appears below AI analysis. Opening it should only read status.
2. Enter a non-sensitive query such as `Spring Boot database connection timeout`. **Check search status** must not invoke Exa.
3. Select **Search references** and verify the dialog shows the intended query and credits notice. Cancel and verify no search occurs. Reopen it; only after agreeing to consume credits, select **Confirm search** once. Confirm at most five relevant, usable links and optional excerpts, or an explicit empty state. Inspect platform usage for the real cost.
4. Refresh/reopen details. The submitted query and saved result should return. Rechecking the same query should reuse the result; continuous clicks during search must not start duplicate calls.
5. Verify another non-admin account cannot access the incident/results. Existing AI analysis and local rule results should remain unchanged.

This change does not implement email handoff, review/preview, pagination or deferred recovery improvements. No commit, push, deployment or paid API call is authorized implicitly by this document.

The confirmation dialog was added after the initial Exa acceptance. The user subsequently confirmed dialog checks 1–4 passed, including cancellation, query display and confirmed search. The agent made no live Exa call to verify the dialog.
