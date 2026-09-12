# IncidentDesk

Turn incident logs into a reviewed email handoff: save an incident, analyze its logs, find troubleshooting references, preview a report, and send it through Gmail.

Built with React, TypeScript and DeepSpace on Cloudflare Workers.

## Integrations

| Integration | Purpose |
| --- | --- |
| OpenAI | Generate analysis with quoted log evidence and suggested checks. |
| Exa | Find troubleshooting links using a query you review and confirm. |
| Gmail | Send the saved handoff after reviewing and confirming its contents. |

Real integration calls use DeepSpace credits. Preparing and previewing reports or email drafts do not invoke these providers.

## Run locally

Requires Node.js 24, npm 11.6+ and DeepSpace access to the existing app.

```bash
git clone https://github.com/lilyyang1014/IncidentDesk.git
cd IncidentDesk
npm ci
npm run login
npm run dev
```
