# Incident handoff preview

Select **Preview handoff report** in an incident detail to open a read-only draft containing the incident title, ID, creation time, local analysis status, saved AI summary/evidence/hypotheses/checks, the latest recorded human judgments for that saved analysis version, the latest successfully completed reference query's saved links/excerpts and original logs.

The browser concurrently reads authenticated AI status and references using the read-only report intent. A subsequent authenticated findings read retrieves the saved human judgments for the expected analysis version. These reads do not generate analysis, search Exa, change incident records or send email. Handoff access remains restricted to the incident creator or an admin, with server-side authorization for each read. A failed read blocks the draft with an error; a successful read with no completed result displays the actual phase instead of inventing content. An incomplete or failed latest attempt does not replace the latest successful result. With no successful selection, the latest attempt state is shown. Legacy successes already hidden by an old failed pointer are not automatically recovered; the preview does not browse history.

Results are a browser preview, not a database report snapshot or approval record. Closing/reopening reloads saved results. Changing the incident data or account remounts the preview and aborts outstanding reads; closing also cancels reads. AI/reference reads are separate, not an atomic database snapshot. The email feature independently assembles and authorizes the exact saved content to send; see [Gmail handoff](incident-email.md).

## Manual acceptance

1. Open an incident with saved AI analysis and reference results. Select **Preview handoff report**. Check title, ID, original logs, summary, evidence lines, hypotheses, suggested checks and reference links against the incident detail.
2. Close using **Close preview**, Escape or the close icon. Existing data should remain unchanged. Reopen to load current saved results.
3. Preview an incident without completed analysis/search. The missing sections should explicitly show their state without starting provider calls.
4. Check that opening/closing previews adds no OpenAI or Exa usage. The report preview itself does not send email or persist approval; email preparation and confirmation are separate actions.

Tests cover status-only requests, cancellation signal propagation, failure handling, missing/running sections, escaped logs and inclusion of saved content. The user confirmed all four manual checks passed: complete content, closing/reopening, explicit missing-result states and no new OpenAI/Exa usage. No paid provider call or deployment was performed for this feature. After acceptance, the user authorized committing and pushing it.

Historical implementation checks: 165 tests across 16 files, type-check, lint and production build passed. Temporary build secret cleanup was verified.
