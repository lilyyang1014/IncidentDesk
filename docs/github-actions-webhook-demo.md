# GitHub Actions → IncidentDesk demo

Status: published as `28150f2` and user-accepted against the production receiver on September 13, 2026. [Run 34774997901](https://github.com/lilyyang1014/IncidentDesk/actions/runs/34774997901) confirmed first-attempt HTTP 201 with `duplicate=false`; the user verified the matching event in IncidentDesk. The observed request took 451.76 ms, one network sample rather than a performance guarantee. Publishing the sender did not require redeploying the app.

This manually dispatched workflow runs a deliberately failing fictional health
check, then automatically sends an incident to the released webhook endpoint.
It does not deploy the app or invoke AI, search or email. No app dependency
installation is required: the sender and its tests use Python's standard library.

## Configure and run

1. Open this repository on GitHub. Select **Settings → Secrets and variables →
   Actions → New repository secret**. Enter the name `INCIDENTDESK_WEBHOOK_TOKEN`.
   Leave this form open before copying any token.
2. In another tab, sign in to **https://incidentdesk.app.space/settings** as the
   account that should own the incident. In **Webhook intake**, create a source.
   If a source already exists and you lost its token, replace it (this invalidates
   its previous token and any sender using it). A local-development token will
   not work in production.
3. Copy the displayed token and immediately paste it into the GitHub secret's
   **Secret** field. Click **Add secret**. Do not put the token in a file, message,
   workflow input or screenshot. Keep the app page open until the secret is saved.
4. Open **Actions → IncidentDesk webhook demo → Run workflow**. Choose **main**
   and click **Run workflow** once. The workflow must first exist on the default
   branch for this button to appear. Only dispatches trigger it; pushing or
   opening a pull request does not send an incident.
5. Open the run. The health check intentionally fails. **Send fictional incident**
   should be green and its output should say `Delivery confirmed`. The final step
   deliberately makes the overall run red to preserve the failed test result.
   A red notification step is a delivery problem, not the expected test failure.
6. In the source owner's IncidentDesk workbench, find exactly one
   **GitHub Actions demo — fictional failure** for this run attempt. Open it and
   check that its original log contains the GitHub run URL and fictional summary.
   If checking Discussion with account B, invite B to this exact incident first.
7. Read the run summary: it retains the fictional payload and each request's
   HTTP status and `request_ms`. Save the run URL, attempt count, status and timing
   for presentation evidence. These are individual network observations, not
   throughput, P95 latency or performance improvements.

## Failure handling and boundaries

- A delivery retries at most three times, with exponential backoff and jitter,
  for network failures, HTTP 408/429/500/502/503/504. It honors `Retry-After` but
  stops for waits over 20 seconds. Each socket has a 15-second timeout; the job
  has a five-minute hard timeout. Authentication failures, conflicts and
  redirects stop immediately. The token only goes to the fixed app hostname.
- The event ID includes repository ID, run ID and **run attempt**. Automatic
  retries reuse identical serialized bytes, including the timestamp. Clicking
  **Re-run jobs** creates a new attempt and can create a new incident; it is
  not a deduplication test or a replay of an uncertain delivery.
- If delivery is unconfirmed, inspect the workbench first. Preserve the exact
  JSON from the run summary and replay that payload with the source token after
  resolving the cause. Do not regenerate its timestamp or event ID. The summary
  follows GitHub run retention; save it before deleting the run. There is no
  durable external queue or automatic later recovery.
- A missing secret fails the notification step without a network call. HTTP 401
  means check the production source and stored secret. HTTP 409 requires
  inspecting event conflicts or capacity. Replacing tokens does not reset quotas.
- Concurrent demo runs are serialized; pending runs may be replaced by newer
  dispatches under GitHub concurrency rules. This is a demo, not an alert queue.
- Existing [webhook limits and ownership](incident-webhooks.md) still apply.
  Shared RecordRoom partitioning and production capacity testing are deferred.

## Local verification

```sh
python3 -B -m unittest discover -s scripts -p 'test_webhook_demo.py' -v
```

Tests mock transport and sleep: no production requests or provider calls.
They cover exact retry bodies, duplicate acknowledgements, exhausted retries,
Retry-After, rejected redirects, malformed acknowledgements and missing secrets.

References: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
