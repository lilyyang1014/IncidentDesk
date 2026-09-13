# IncidentDesk

Investigate incidents together and turn findings into a reviewed email handoff. Save logs, invite a collaborator by email, and share discussion notes in real time across devices. Use AI analysis and troubleshooting references to investigate, record human judgments on hypotheses, then preview and send the findings through Gmail.

Each incident supports its creator and one collaborator. Share an invitation link; the recipient signs in with the invited email and accepts to join, even if they have never used IncidentDesk before. Invitation emails are not sent automatically.

Built with React, TypeScript and DeepSpace on Cloudflare Workers.

## Integrations

| Integration | Purpose |
| --- | --- |
| OpenAI | Generate analysis with quoted log evidence and suggested checks. |
| Exa | Find troubleshooting links using a query you review and confirm. |
| Gmail | Send the saved handoff after reviewing and confirming its contents. |

Integration calls use the signed-in caller's DeepSpace credits. Preparing and previewing reports or email drafts do not invoke these providers.

## Run locally

Requires Node.js 24, npm 11.6+ and DeepSpace access to the existing app.

```bash
git clone https://github.com/lilyyang1014/IncidentDesk.git
cd IncidentDesk
npm ci
npm run login
npm run dev
```
