# Bounded incident webhook intake

Status: deployed as release 11 on September 13, 2026. The [GitHub Actions demo](github-actions-webhook-demo.md) subsequently delivered a fictional event to production and passed user acceptance. This is a generic sender contract, not native GitHub/Grafana payload compatibility. Production load testing remains unperformed. Performance evidence and reproducible commands are in [the measurement report](performance/webhook-performance.md).

## Flow and ownership

In **Settings → Webhook intake**, a signed-in app user creates one source. The server binds that source to the user; a sender cannot choose the owner or collaborator. The one-time source token is shown masked and can be copied. It is kept only in component memory; after reload it cannot be retrieved. Store it in the sender's secret manager. Replacing it immediately invalidates the previous token and re-enables the source. Disabling it rejects new deliveries and retries while preserving existing incidents. Check status after an uncertain management response; if a new token response was lost, replace it after the cooldown. Do not automatically retry rotations.

A successful delivery creates an ordinary incident owned by the source creator. It uses the existing incident list, permission-aware live broadcasts, invitations, Discussion and reviewed handoff flow. Each new event ID creates one incident; semantic alert grouping, resolved notifications, updates to existing incidents and ordering of external events are not implemented. Nothing automatically invokes OpenAI, Exa, Gmail, or the supplied source URL.

## Sender contract

`POST /api/webhooks/incidents`, `Content-Type: application/json`, `Authorization: Bearer <source token>`. Use HTTPS outside localhost development. The same endpoint serves all sources; the secret is never part of the URL.

```json
{
  "eventId": "demo-failure-001",
  "occurredAt": "2026-09-13T08:00:00Z",
  "title": "Demo service alert",
  "summary": "Fictional timeout during a health check.",
  "sourceUrl": "https://example.test/runs/001"
}
```

Use a current ISO timestamp for a new test. The Settings example supplies one. `eventId` accepts 1–128 ASCII letters/digits and `.`, `_`, `:`, `-`; keep it stable across retries. Title is trimmed and limited to 120 UTF-16 code units; summary preserves whitespace and is limited to 19,000. Optional source URL is HTTPS, at most 512 characters and contains no username/password. The URL is stored as text in the original log, never fetched. Unknown fields are rejected. The actual streamed UTF-8 body is capped at 32 KiB with a 10-second body deadline; character and byte limits both apply. Metadata plus summary fits the existing 20,000-character incident log bound.

| Response | Meaning / sender action |
| --- | --- |
| 201 | Saved and confirmed; response contains `data.recordId` |
| 200 | Matching event already saved or recovered; same record ID |
| 400 / 413 / 415 | Invalid fields/time, oversized request, or wrong media type; correct the sender |
| 401 / 403 | Invalid/disabled source or owner no longer eligible; correct credentials/access |
| 409 | Event ID reused with different normalized content, stale source version, or capacity exhausted; inspect `code`, do not blindly retry |
| 410 | Incident was deleted/replaced; replay will not recreate it |
| 429 | Rate or daily limit; honor `Retry-After` |
| 408 / 503 / network failure | Outcome not confirmed; retry the same ID and body with bounded exponential backoff and jitter; honor `Retry-After` when supplied |

The sender must retain failed events and surface exhausted retries for operator review. This endpoint is synchronous, with no autonomous queue or eventual-processing promise: no success is returned before incident persistence is confirmed. A sender that drops failed deliveries can lose alerts. No end-to-end exactly-once delivery guarantee is made.

## Security and admission bounds

A source token contains a random source ID and 256 random secret bits. Only its SHA-256 digest is stored in private SQLite, and digest comparison scans all bytes. Management requires a verified user JWT and current app membership at the room; source credentials grant ingestion only, never record reads, membership changes or paid actions. The public route discards client identity headers, fixes the destination room/action and validates the body before forwarding. The room independently validates the source token and payload, and rechecks the owner's app membership. Responses are no-store. Logs contain operation/status/duration only, not credentials, payloads or external URLs.

| Limit | Initial policy |
| --- | --- |
| Sources | One per account; 100 total per app |
| Token replacement | At least 60 seconds between changes |
| Authenticated requests, including duplicates | Source burst 20, one restored per 100 ms; app burst 50, one restored per 20 ms |
| New event admission | Source burst 3, one restored per 12 seconds; app burst 10, one restored per second |
| New admissions per UTC day | 100 per source/account; 1,000 per app |
| Lifetime admissions | 1,000 per source/account; 10,000 per app |
| First delivery event time | Last seven days, with up to five minutes of future clock skew |

Counters persist across restart and token replacement. One source per account makes its admission budget also the account's budget. These are conservative initial policies, not measured maximum capacity. Webhook admission does not consume the manual-create bucket. App-level webhook limits reserve headroom by restricting intake; they do not schedule/prioritize Discussion or guarantee a latency SLO. Invalid but well-shaped tokens still incur room lookup/hash work; this increment is not edge DDoS protection. Per-source management reads likewise have no new edge limit.

## Persistence, concurrency and retention

Private tables `webhook_sources`, `webhook_receipts`, `webhook_budget`, and `webhook_requests` are never SDK collections. Source/event is a primary key; receipt record ID is unique. Receipt lookup is indexed, source state is bounded to 100 rows and receipt state to 10,000 admitted events. One bounded JSON budget row holds app/account admission counters; another holds authenticated request buckets. Admission counters and the accepting receipt are committed together with SQLite `transactionSync` before the asynchronous SDK create.

The existing room gate serializes management, intake and the app's guarded operations. It is not one database transaction across the SDK call. Recovery uses a deterministic record ID and receipt state: before-write interruption can retry creation, after-write interruption reads the existing record and finalizes its receipt. Once accepted, edits do not cause replay to overwrite an incident. A SQLite delete trigger marks its receipt removed, including an unfinished accepting receipt, so deletion cannot cause replay resurrection. The trigger is deliberately coupled to installed SDK 0.33.1's `c_incidents._row_id`; review and run the runtime deletion test on SDK upgrades.

Receipts retain only the content digest and identity/state, not a second full payload. They are not automatically purged in this version: lifetime admission caps bound their growth and preserve deletion/replay protection. Existing saved incidents, notes and other features have their own growth. Limits do not prove that the account's full storage allowance can never be exhausted. No automatic quota reset, source deletion, payload archive, orphan cleanup, backup restoration or disaster recovery is implemented. An unfinished acceptance needs the sender's matching payload retry; there is no background recovery job.

## Architecture tradeoff and rollback

The app-scoped RecordRoom remains the authority. Reuse keeps current lists, permissions and subscriptions intact; ingestion can still contend with unrelated incident operations. Use the measurement report to evaluate target workload behavior before splitting. A queue would absorb bursts but not increase this room's sustained write capacity. Source/incident partitioning and cross-partition listing/revocation remain separate designs.

No dependency, public business schema, Durable Object binding or integration billing changes are introduced. Before reverting to an older build, disable sources and resolve any unfinished accepting receipts. Keep private tables and the deletion trigger; code rollback is not data rollback. Old builds do not serve the new endpoint/settings controls, while saved incidents remain ordinary readable records. A downgrade/re-upgrade that drops the deletion trigger can invalidate replay protection, so preserve it or reconcile receipts explicitly. No production rollback or backup restore was rehearsed.

## Verification and manual acceptance

Automated tests use synthetic identities/data, real isolated SQLite and Workers, and blocked external traffic. They cover source isolation, strict payloads, secret status exclusion, token rotation/cooldown, rate/daily/lifetime/app limits, admission transaction rollback, interrupted writes, deletion during unfinished acceptance, stalled/oversized bodies, and generic incident permissions. The real runtime test sends 12 matching concurrent deliveries and checks one incident, owner live notification, excluded-user denial, collaborator notes, restart persistence, deletion, limits and disable. Existing invitation/collaboration runtime regressions pass. These are not native-provider delivery or production-load tests.

Local browser verification: the signed-in account created a source with zero events, refreshed and no longer saw the copy-token control, cancelled a disable confirmation, then confirmed disable. No token value was read into tool output and no event was sent through that local UI fixture. The user subsequently confirmed local source setup, HTTP 201 creation and workbench visibility, identical replay returning HTTP 200 / the same record ID with no duplicate incident, changed-content HTTP 409 refusal, shared Discussion, disable cancellation and confirmed-disable HTTP 401 refusal. A reported missing note was resolved by opening the same incident on both accounts; no code defect was established. The following steps remain the reproducible manual checklist:

1. Open local **Settings → Webhook intake**. Create a source (or replace the disabled test source token), copy its token into a sender such as Postman, and keep it private.
2. Send the Settings example to the displayed endpoint using POST/JSON and the Bearer token. Expect 201 and find exactly one incident in **My incidents**. Verify the title, timestamp, original source link if present, and summary.
3. Repeat the exact request. Expect 200 with the same record ID. Change the summary while retaining the event ID; expect 409 and unchanged incident content.
4. Invite account B to the incident and post a fictional Discussion note; A should see it. B must not gain source management or access to A's token.
5. Disable the source and retry; expect 401. Existing incident/discussion data should remain. Oversize, high-rate and crash cases are covered by isolated tests; do not run burst/load tests against production.

References: [DeepSpace data model](https://docs.deep.space/concepts/data-model), [permissions](https://docs.deep.space/concepts/permissions), [background jobs](https://docs.deep.space/guides/background-jobs), and [custom bindings](https://docs.deep.space/guides/custom-bindings). The installed optional-feature catalog has no matching prebuilt generic incident-ingestion feature. Future background provider work must separately review caller/owner billing rather than inheriting owner-paid job defaults.
