# Email-bound incident invitation links

Status: deployed as release 10 on September 13, 2026. The user confirmed cross-device invitation acceptance and Discussion visibility in production. No invitation mail delivery is implemented or invoked. Automated revocation coverage is separate from that production acceptance.

## User flow

The incident creator opens **Collaborators**, enters a recipient email, and chooses **Create invitation link**. The recipient does not need an existing IncidentDesk app record. The creator copies and shares the link manually. The recipient signs in for the first time, reviews the invitation and explicitly selects **Accept invitation**. Only then is an ordinary collaborator membership created.

The link is scoped to the environment that created it. A localhost link opens the recipient's own computer when shared across machines; use the deployed application after a separately authorized release for a remote demo. For local acceptance, use two independent browser profiles on the same local app server.

One pending invitation reserves the existing single collaborator slot. Invitations expire after seven days. The creator may cancel an unaccepted invitation; accepted invitations require the existing **Remove collaborator** confirmation to revoke access. The creator can reload or use **Check invitation status** to retrieve the current saved link and phase. Status is explicitly refreshed, not continuously polled.

## Trust and identity

- The public endpoint is `POST /api/incident-invitations`, with an actual streamed body limit of 4,096 bytes and `Cache-Control: no-store` responses. It requires a bearer JWT and forwards only that authorization and the selected platform session cookie to the app-scoped RecordRoom. Arbitrary caller identity headers are not forwarded.
- The room independently verifies the JWT. Recipient inspect/accept operations ask the configured authentication authority for `/api/auth/get-session?disableCookieCache=true&disableRefresh=true` outside the shared room gate. The response must contain `emailVerified: true`, a non-expired session, and matching session/user/JWT subjects. Redirects are not followed. A failure never falls back to an editable `users` profile or an unsigned browser email.
- Creator operations independently check current app membership and incident ownership; admin status does not grant invitation management on someone else's incident. Recipient operations match the verified mailbox before reading incident metadata. The room rechecks the incident ID, creation time and owner inside its existing concurrency gate.
- Email matching trims surrounding whitespace and compares lowercase addresses. It deliberately does not collapse Gmail dots, plus aliases, or addresses from different domains. A login must expose the invited address as its verified primary email; having a different verified account or merely possessing the URL is insufficient.
- Links use 256 random bits in a URL fragment, omitted from HTTP paths and referrer URLs. The latest token and address are stored only in a private SQLite table, never an SDK collection or public roster. The token remains retrievable by the creator; it is not stored as a one-way hash. Treat copied links as private. Before acceptance the recipient sees the matching invitation email and expiry, not the incident title, logs or AI output.
- On successful acceptance the existing membership grants saved incident/AI/reference reads, notes and hypothesis judgments. It does not grant member management, paid operations or email handoff privileges. Existing broader admin privileges are unaffected.

The existing SDK login uses a full-page redirect back to `/home`. A validated, tab-local sessionStorage hint retains the invitation for up to 30 minutes and returns the signed-in user to `/invite`; it never accepts automatically. If browser storage is blocked, reopening the original link is the fallback. Account and token changes remount the acceptance state and abort old reads.

## Concurrency and durability

The authoritative app RecordRoom serializes invitation checks, reservations and SDK membership operations with existing membership changes. A creation request UUID deduplicates the latest operation; an expected-invitation token prevents stale windows from replacing newer invitations. Identical creation retries recover the same saved invitation, including its cancelled state, without generating a new link. An old superseded request cannot override the current invitation.

Acceptance reserves the recipient user ID in an `accepting` receipt before the asynchronous SDK membership write, then finalizes `accepted`. These writes are not one atomic transaction. If execution stops before the membership write, retrying the same invitation can finish it. If membership persisted first, the existing member and receipt reconcile as accepted without another write. An accepted receipt with no remaining membership is revoked and cannot grant access again. Removal also invalidates an unfinished accepting receipt before deleting membership, preventing a crash-window replay from restoring access. If removal fails, existing access may remain; the invitation is conservatively invalidated and the existing removal UI requires saved-state review.

Cancelled, expired, replaced or revoked invitations cannot create memberships. Acceptance and cancellation are serialized: either cancellation wins, or an already accepted invitation must be handled through member removal. Parent deletion/recreation invalidates old invitations. SDK membership writes and room resubscription retain live permission propagation and subsequent server-side permission enforcement. Previously downloaded data cannot be retracted.

## Bounds and limitations

- At most one latest invitation row per incident incarnation and one creation-quota row per creator. Token and source lookups are indexed. Replacing an invitation overwrites the latest row rather than accumulating an invitation history.
- New invitations are limited to ten per creator per UTC day, with at least one minute between creations. Limits persist across restarts. Quota reservation is conservative if the later invitation write fails. Identical saved retries do not consume another creation. This is separate from existing incident/note/provider quotas.
- Expiry is enforced on reads and writes, not by scheduled deletion. Deleted incidents can leave an orphaned private invitation row; there is no general cleanup/history UI or membership audit in this increment.
- Each recipient inspect/accept adds one live authentication-service read. Creator status/create/cancel makes no authentication-provider or paid-provider call. No broad quota was added to all authentication reads; high-volume abuse and production capacity require separate measurement.
- The app-scoped RecordRoom and broad membership resubscriptions remain shared bottlenecks. No partitioning, new service, DO binding, secret, package dependency or public business schema was introduced. No latency improvement, production throughput or recovery objective is claimed; performance is unmeasured for this increment.
- No invitation emails, automatic sending, paid calls, pre-created placeholder accounts or unrestricted membership counts.

## Verification

Local checks: 310 tests in 33 files, TypeScript and ESLint passed. Production build passed; its existing sandbox restriction on Wrangler's diagnostic log location was nonfatal. The real Workers/SQLite check caught and led to correcting a Worker-incompatible `redirect: 'error'` option; the final adapter uses `manual` and rejects non-success responses.

`scripts/verify-incident-invitations.mjs` uses isolated real Workers, SQLite, signed synthetic JWTs and WebSockets. Authentication responses are mocked and all other outbound traffic is blocked. It covers a recipient with no prior app record, first app connection, wrong/unverified/missing session, creator/admin restrictions, no access before confirmation, six concurrent accepts producing one member, live access, shared-list inclusion, note permission, handoff denial, pending and accepted restart persistence, cancellation, removal, old-link rejection, retained notes and oversized bodies. The completed run used 13 mocked authentication reads and zero external calls. The existing collaboration runtime regression also passed with zero external calls.

Unit tests additionally cover expiry, stale/forged inputs, mailbox matching, quota limits, bounded latest-row storage, crashes before/after membership persistence, removal during unfinished receipt recovery, deletion/recreation, session verification, fragment parsing, bounded OAuth return hints and no automatic client retry. These are not full browser OAuth/signup end-to-end tests.

Local browser evidence: the existing signed-in account passed live authentication verification on an invalid invitation lookup (read-only, no token/profile output). Created `Invitation link demo — fictional` with synthetic logs, created an unsent invitation to `nobody@example.test`, verified copying and exact link restoration after reload, then cancelled it. At a 390px viewport, the dialog was 358px wide and page scroll width remained 390px. No captured browser console errors. The fixture remains in local data with no collaborator and a cancelled invitation. The agent performed no live recipient acceptance, new account creation, email or paid integration. The user subsequently confirmed manual steps 1–3 below. An initial unavailable-invitation report was traced to a mistyped recipient domain (`gmai.com` instead of `gmail.com`); addresses must match the verified login email. Step 4 remains covered by automated checks, without separate user confirmation.

## Manual acceptance

1. Refresh the local app as creator A. Open `Invitation link demo — fictional`, choose **Collaborators**, enter the email used by B's Google/GitHub sign-in and create a link. Verify **Pending**, copy it, then reload A and verify the same invitation remains.
2. In a separate browser profile or incognito window on the same computer, open the copied link. B may be new to this local environment. Sign in with the invited address; expect the invitation review after login (or reopen the original link if storage is blocked). Accept once, then choose **Open shared incident**.
3. Verify B can view logs and write a fictional discussion note, but has no **Handoff** or member-management controls. A checks invitation status and sees **Accepted**. Refresh both windows and verify access and the note persist.
4. A removes B using the existing confirmation dialog. B must lose event access, and reopening/retrying the original invitation must not restore it. The note remains for A. Wrong-account, cancellation and expiry branches are automated; optional manual repetition can use another fictional event and respect the creation cooldown.

## Release and rollback

The user explicitly authorized publication after confirming manual steps 1–3. Frontend and backend must ship together. Pending links created locally are not migrated or valid on production. Refresh existing clients after release; the legacy registered-user backend path remains available for compatibility and obeys pending-slot reservations.

An application rollback preserves existing membership/note data; accepted memberships use the original schema. Pending invitations become unavailable when the old UI/routes are restored. Before downgrading past invitation support, cancel pending invitations and reconcile all unfinished accepting receipts, or retain the new removal-invalidation hook. Otherwise an older removal path cannot invalidate an unfinished receipt before a later re-upgrade. Do not delete private tables as an incidental rollback step. Code rollback is not data recovery, and production downgrade/backup restoration has not been rehearsed.

References consulted: [DeepSpace worker authentication](https://docs.deep.space/sdk-reference/worker/auth), [permissions](https://docs.deep.space/concepts/permissions), and [Better Auth session management](https://better-auth.com/docs/concepts/session-management), cross-checked with installed SDK 0.33.1 and the installed Better Auth session endpoint. The bundled documents feature's invite dialog only edits ACLs for known users and does not satisfy this pre-registration workflow.
