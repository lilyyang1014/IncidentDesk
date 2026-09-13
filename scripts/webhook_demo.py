"""Bounded, dependency-free sender for the manually dispatched fictional demo."""
import datetime
import email.utils
import http.client
import json
import os
import random
import re
import time

HOST = "incidentdesk.app.space"
PATH = "/api/webhooks/incidents"


def payload(env, now):
    repo = env.get("GITHUB_REPOSITORY", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid GitHub repository context")
    ids = [env.get(key, "") for key in
           ("GITHUB_REPOSITORY_ID", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")]
    if not all(re.fullmatch(r"[0-9]{1,20}", value) for value in ids):
        raise ValueError("Invalid GitHub run context")
    return json.dumps({
        "eventId": "github:" + ":".join(ids),
        "occurredAt": now.isoformat(),
        "title": "GitHub Actions demo — fictional failure",
        "summary": "Fictional health check expected HTTP 200 but received 503. "
                   "This is an intentional demonstration, not a production outage.",
        "sourceUrl": "https://github.com/" + repo + "/actions/runs/" + ids[1],
    }, ensure_ascii=True).encode("utf-8")


def request(token, body):
    # Fixed destination; http.client never follows redirects or forwards this token.
    connection = http.client.HTTPSConnection(HOST, timeout=15)
    try:
        connection.request("POST", PATH, body, {
            "Authorization": "Bearer " + token, "Content-Type": "application/json"})
        response = connection.getresponse()
        return response.status, response.getheader("Retry-After"), response.read(8193)
    finally:
        connection.close()


def retry_delay(header, attempt):
    delay = 2 ** (attempt - 1) + random.uniform(0, 0.5)
    if header is not None:
        try:
            seconds = int(header) if header.isdigit() else (
                email.utils.parsedate_to_datetime(header).timestamp() - time.time())
            delay = max(delay, seconds)
        except (ValueError, TypeError, OverflowError):
            raise ValueError("Invalid Retry-After; inspect delivery before retrying") from None
    if delay > 20:
        raise ValueError("Retry-After exceeds demo budget; retry saved payload later")
    return delay


def deliver(token, body, send=request, sleep=time.sleep, report=print):
    if not re.fullmatch(r"[A-Fa-f0-9-]{36}\.[A-Fa-f0-9]{64}", token):
        raise ValueError("Missing or invalid INCIDENTDESK_WEBHOOK_TOKEN secret")
    for attempt in range(1, 4):
        start = time.monotonic()
        status, retry_after, response_body = 0, None, b""
        try:
            status, retry_after, response_body = send(token, body)
        except (OSError, http.client.HTTPException):
            pass  # Never print network exception text, headers or credentials.
        report("Attempt %d: HTTP %d; request_ms=%.2f" %
               (attempt, status, (time.monotonic() - start) * 1000))
        if status in (200, 201):
            try:
                result = json.loads(response_body)
                data = result["data"]
                valid = (result["success"] is True and
                         isinstance(data["recordId"], str) and bool(data["recordId"]) and
                         isinstance(data["duplicate"], bool) and len(response_body) <= 8192)
                if not valid:
                    raise ValueError()
            except (ValueError, KeyError, TypeError):
                raise ValueError("Unconfirmed response; inspect incident before retrying") from None
            report("Delivery confirmed; duplicate=" + str(data["duplicate"]).lower())
            return
        if status not in (0, 408, 429, 500, 502, 503, 504):
            raise ValueError("Delivery refused (HTTP %d); inspect source or payload" % status)
        if attempt < 3:
            sleep(retry_delay(retry_after, attempt))
    raise ValueError("Delivery unconfirmed after 3 attempts; retain and reconcile saved payload")


def main():
    body = payload(os.environ, datetime.datetime.now(datetime.timezone.utc))
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")

    def report(message):
        print(message)
        if summary_path:
            with open(summary_path, "a", encoding="utf-8") as summary:
                summary.write(message + "\n\n")

    # Fictional content only. Save before delivery so an uncertain result is recoverable.
    report("## Fictional webhook delivery\n\nSaved payload (no credentials):\n```json\n" +
           body.decode() + "\n```\n\nRequest timing includes sender/network/server time; "
           "it excludes runner queue/startup and browser visibility. This is not a load benchmark.")
    try:
        deliver(os.environ.get("INCIDENTDESK_WEBHOOK_TOKEN", ""), body, report=report)
    except ValueError as error:
        report(str(error))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
