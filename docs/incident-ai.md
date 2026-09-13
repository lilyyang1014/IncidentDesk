# Incident AI analysis

On September 11, 2026, the user reported that the four checks proposed in the conversation behaved as expected and that Generate AI analysis produced a report. Manual acceptance is user-confirmed; the user supplied completed API usage records totaling $0.0226 and reports that free-plan credits covered the usage without additional out-of-pocket payment. This is user-reported billing evidence, not an independent account audit. All automated provider responses remain simulated.

## Behavior

Open an existing incident. The **AI analysis** section reads saved analysis status without calling OpenAI. **Generate AI analysis** explicitly sends the saved title and logs through DeepSpace's `openai/chat-completion` integration. The caller's DeepSpace account pays. The UI displays this before generation.

Results contain a summary, exact log evidence, tentative hypotheses and suggested checks. They are saved separately from local rule analysis and restored on detail navigation or refresh. The existing list status continues to describe local rule analysis; AI completion does not change it.

## Data flow

1. The browser posts `{ incidentId, intent }` to `/api/actions/analyzeIncident` with its session token. It cannot choose the model, billing account or log text.
2. A private `AppIncidentAiRoom` verifies the JWT and app membership and loads the record. Generation requires its creator or an admin; saved-status reads also allow a current collaborator. Access is checked again before returning data after a slow call.
3. A SHA-256 identity includes the record ID, creation metadata, title and exact saved logs. A transactional receipt prevents overlapping calls for the same input across tabs/devices/accounts.
4. The provider adapter uses the fixed configuration in `src/integrations.ts`, the caller JWT and app identity. OpenAI remains blocked in the generic browser proxy; the private business adapter is its only enabled application path.
5. The server rejects incomplete/non-JSON output, invalid structures, fabricated quotes, duplicate evidence lines and hypotheses referring to uncited lines. Exact quote validation does not prove a hypothesis or summary is true; human review remains necessary.
6. Validated output is stored in the private coordinator's SQLite-backed storage. No API credentials or full raw-log snapshot are stored there. Quotes from the log are part of the result.

The local `wrangler.toml` binding/migration and the worker's deployment manifest both include `INCIDENT_AI_ROOMS`. This is a durable receipt/result store, not a background job queue. It does not resume model calls after a Worker interruption.

## Limits and recovery

- Model: `gpt-5.6-terra`, matching the verified DeepSpace catalog default. Maximum output: 2,200 tokens.
- Input: nonblank title up to 120 characters, nonblank saved logs up to 20,000 characters, enforced server-side for AI requests.
- Maximum 10 attempted provider requests per caller per UTC day and at least one minute between requests. Failed attempts count conservatively.
- Maximum three attempts for the same input. Only known failures allow manual retries; no automatic paid retries occur.
- A complete result is reused. A changed title/log produces a new input identity, subject to the same account quota.
- **Check AI status** never invokes OpenAI. Use it after a disconnect or when another tab is processing the event.
- Unknown outcomes block a fresh call for the same input. After 150 seconds, an unfinished receipt displays an interrupted/unknown message. There is currently no user reset/reconciliation operation for an orphaned request.
- AI records are not broadcast through RecordRoom. Another tab reads them on opening details or through **Check AI status**.
- Results for old input versions remain private in the coordinator. Deletion/retention cleanup is not implemented; a deleted/inaccessible incident cannot expose them through the API.

## Verification

Run from the project root with Node.js 24 and the locked dependencies installed:

```bash
npm run test:unit
npm run type-check
npm run lint
npm run build
node scripts/verify-incident-ai.mjs
```

The runtime script uses temporary storage, ephemeral test signing keys, real Worker/RecordRoom/analysis code and a simulated API service binding. External network access from its Worker is disabled. It verifies cross-account refusal, simultaneous-request deduplication, database persistence across runtime restart and result reuse. It does not access the user's actual app records or call OpenAI. Local socket permissions may be required by the execution environment.

At implementation time: 117 unit tests passed, type-check and lint passed, production build passed and temporary build secret cleanup was verified. The isolated runtime script passed with one simulated provider call and no external calls. The agent browser encountered fetch/client-blocking errors during implementation. The user subsequently confirmed successful manual acceptance and report generation; the agent did not independently repeat the live call.

## Manual acceptance

Before any real generation, explicitly authorize the paid test and use sanitized logs. The user has reported a successful provider-backed result. The DeepSpace catalog has no curated output schema; the adapter accepts the standard Chat Completions envelope and fails explicitly on unfamiliar shapes. The checklist below is a reusable full checklist, not a claim that the user separately verified every item.

1. Open an existing incident. Confirm the separate **AI analysis** section appears and checking status does not alter the incident or local analysis.
2. After paid-test authorization, generate one analysis for a fictional log containing a blank second line and `request timed out` on line 3. Confirm summary, **Log evidence**, **Possible causes — not confirmed** and **Suggested checks** appear; every displayed quote must match its saved line.
3. Refresh the detail and reopen its URL. Confirm the same saved result appears without generation.
4. During a generation, confirm the button is disabled. Use another tab to check status; it must not start another provider request for the same input.
5. Under an uninvited non-admin account, confirm the event remains inaccessible. A current collaborator may read saved analysis but cannot generate it. Automated isolated tests already exercise the action path directly; no paid unauthorized call is needed.
6. Insufficient credits, invalid response, timeout and storage failures are covered by simulations. Do not spend money or physically disrupt the user's live server merely to repeat those tests.

The agent performed no commit, push, deployment, email or real paid API call as part of implementation or the documentation update. The user subsequently generated a report personally. The user subsequently authorized a consistency review, Git commit and push. Deployment and additional paid calls still require explicit authorization.
