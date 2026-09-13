# Webhook performance evidence

Measured September 13, 2026. All results are isolated local measurements with synthetic data and zero external calls. No production load test, paid provider or deployment was used. This increment adds functionality; it is not an optimization with a claimed speedup.

## Environment and protocol

- Apple M2, macOS arm64, Node 24.21.0, DeepSpace SDK 0.33.1, real Miniflare/workerd with SQLite persistence. Each trial starts a fresh temporary database and deletes it afterward. No network round trip to production or real authentication provider.
- 1,000 seed incidents plus 41 discussion incidents, with 1,000-character synthetic logs. Fixture setup is excluded from timing. Each trial adds 105 foreground incidents and 105 notes (5 warmups, 100 measured of each), plus accepted webhook incidents when load is enabled.
- 41 synthetic author accounts are registered; 20 authors supply measured operations, one separate author supplies warmup. One distinct observer account is a collaborator on the discussion incidents and has one subscribed WebSocket. Authors use authenticated HTTP actions, not full browser sessions.
- Foreground work is closed-loop: one incident create followed by one note, with at most one foreground action in flight. Measure 100 samples per metric per trial, repeated three times. Percentiles below use the nearest-rank calculation over pooled 300 samples, not an average of percentiles.
- Create/Discussion acknowledgement timing includes local HTTP dispatch, JWT verification, room checks, SQLite/SDK work and JSON response consumption. Discussion visibility measures from the note request start to the observer receiving its record-change frame; it excludes browser rendering and WAN delay.
- Paced runs wait 100 ms after each create/note pair. Loaded runs also have one independent sender offering one webhook every 200 ms (~5 requests/s), round-robin over 20 sources. No retries are performed in this load experiment: 429 responses are counted as deliberate refusal. Functional retry/concurrency tests are separate.
- Tests/builds were finished before final measurements. Other desktop processes remain uncontrolled; no statistical significance, cold-start SLO, maximum sustained throughput, P99 or supported user-count claim is made. Runs are short (~12 seconds each), and initial token-bucket bursts matter.

## Final-build idle versus offered webhook load

| Operation / condition | P50 (ms) | P95 (ms) |
| --- | ---: | ---: |
| Manual create, idle | 9.50 | 14.22 |
| Manual create, ~5 webhook requests/s | 8.53 | 13.44 |
| Discussion acknowledgement, idle | 7.75 | 11.26 |
| Discussion acknowledgement, loaded | 7.09 | 11.22 |
| Observer receives Discussion note, idle | 6.54 | 10.01 |
| Observer receives Discussion note, loaded | 6.03 | 10.18 |
| Successful webhook save, loaded (66 samples) | 7.65 | 14.18 |

Discussion visibility P95 changed from 10.01 to 10.18 ms: **+0.17 ms (+1.66%)**. Other metrics fluctuate in both directions; decreases under load are not evidence that webhooks improve performance. This experiment found no timeouts or failed foreground operations under its bounded workload, not proof that shared-room contention cannot occur.

| Loaded trial | Requests | Saved | Limited (429) | Other errors | Duration (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 61 | 22 | 39 | 0 | 12.23 |
| 2 | 62 | 22 | 40 | 0 | 12.43 |
| 3 | 63 | 22 | 41 | 0 | 12.64 |

Across three loaded trials, 66 events were saved. The app policy permits an initial burst of 10 and restores one new-event admission per second. The observed ~1.7–1.8 saved events/s over these short trials includes that burst and **must not be advertised as sustained capacity**. Rejected calls consumed real local work; rate limiting does not remove ingress costs.

## Pre-implementation baseline comparison

The pre-change bundle was built from the invitation implementation at local HEAD `89d5d71`; README edits did not affect the app. Baseline runs were captured before Webhook code changes. They used the same dataset/foreground operations with no pacing and no webhook sender. Final unpaced runs repeat that protocol on the completed build. Do not compare these unpaced figures against the paced table: scheduling and warm-path behavior differ.

| Operation | Before P95 (ms) | After P95 (ms) | Difference (ms) |
| --- | ---: | ---: | ---: |
| Manual create | 2.02 | 2.16 | +0.14 |
| Discussion acknowledgement | 2.52 | 2.58 | +0.06 |
| Observer receives Discussion note | 2.12 | 2.16 | +0.03 |

This is a small local before/after observation, not a causal optimization claim. The original baseline files contain raw samples but predate machine/build-hash metadata in the harness; that provenance limitation is retained explicitly. Final files include machine, timestamp and server-bundle SHA-256.

## Correctness evidence and appropriate resume wording

The isolated real Worker test sent **12 simultaneous identical deliveries and observed exactly one incident**, with the other 11 responses returning its existing ID. It also verified owner-only initial visibility, collaborator notes, receipt/source persistence through runtime restart, replay refusal after deletion, size/rate limits and source disable. Unit tests simulate interruptions before and after SDK persistence; they do not constitute a production crash or backup-restoration rehearsal.

Potential factual wording: “Built authenticated, idempotent webhook ingestion; verified 12 concurrent duplicate deliveries produced one incident and measured 14.2 ms P95 local save latency under a ~5 requests/s offered workload with admission control.” Include the local environment and note that 66 accepted samples underpin this latency. Do not claim zero data loss, exactly-once delivery, large-scale production throughput or an invented percentage improvement.

## Reproduce and inspect

Use the supported Node runtime, install locked dependencies, and build the intended revision first. These scripts use a fresh temporary Worker/SQLite store, block external traffic and never touch the local app database or production.

```bash
npm run build
node scripts/verify-incident-webhooks.mjs
node scripts/benchmark-webhook-impact.mjs my-idle --pace
node scripts/benchmark-webhook-impact.mjs my-load --load --pace
node scripts/benchmark-webhook-impact.mjs my-unpaced
```

Use unique output labels to preserve previous evidence; run three sequential idle/load pairs without competing tests/builds. JSON outputs are written beside this report. Baseline files are `webhook-baseline-{1,2,3}.json`; final unpaced files are `webhook-final-idle-{1,2,3}.json`; final paired files are `webhook-paced-{idle,load}-{1,2,3}.json`. Each keeps individual timing samples and trial counts.

These experiments support keeping the shared RecordRoom for the initial bounded intake policy. Larger datasets, longer soaks, higher contention, real network/browser latency and explicit product latency targets are needed before selecting a partitioning threshold or promising a production SLO. Queue adoption and partition migration remain separate decisions.
