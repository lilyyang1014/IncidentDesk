# Verification and demo scripts

Run commands from the repository root with Node.js 24 and dependencies installed through `npm ci`. Python scripts use Python 3's standard library.

| Files | Purpose | External effects |
| --- | --- | --- |
| `verify-incident-*.mjs` | Exercise the built app in isolated Workers/SQLite, including permissions, concurrency and restart recovery. | Temporary storage and generated test identities; external Worker traffic is blocked or mocked. |
| `benchmark-*.mjs` | Measure local write and notification latency under synthetic workloads. | Temporary storage; no production load. The webhook benchmark writes JSON evidence to `docs/performance/`. |
| `test_webhook_demo.py` | Verify retry, acknowledgement and sender behavior. | Transport and sleep are mocked. |
| `webhook_demo.py` | Send a fictional GitHub Actions failure to IncidentDesk. | **Real production write** when run with valid GitHub context and a source token; no AI, search or email calls. |

## Local checks

```bash
npm run test:unit
npm run type-check
npm run lint
python3 -B -m unittest discover -s scripts -p 'test_webhook_demo.py' -v
```

Build before running an isolated Worker verification script:

```bash
npm run build
node scripts/verify-incident-webhooks.mjs
```

These scripts require local runtime/socket permissions. They use the built Worker at `dist/incidentdesk/index.js`, so rebuild after changing application code. The scaffold Playwright suites in `tests/` are separate from these incident-specific checks.

Use unique benchmark labels to preserve previous samples; see the [performance methodology](../docs/performance/webhook-performance.md). Follow the [Actions demo guide](../docs/github-actions-webhook-demo.md) for the production sender. Do not run all scripts indiscriminately or place real credentials in fixtures.
