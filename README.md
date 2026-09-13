# IncidentDesk

IncidentDesk is a shared workspace for investigating software incidents and turning findings into a reviewed email report. Save logs, use AI to explore possible causes, find troubleshooting resources, and discuss what you discover. Record which explanations the evidence supports or rules out, then review a report before sending it through Gmail.

[Open IncidentDesk](https://incidentdesk.app.space)

Invite one collaborator to an incident by sharing a link tied to their email address. They can join after signing in, and discussion notes appear in real time across devices. Invitation links are shared manually; the app does not send invitation emails.

External tools can also create incidents through a webhook. The included GitHub Actions demo shows how a fictional test failure becomes an incident, with a summary and a link to the failed run. Receiving an event does not automatically run AI analysis, search the web, or send email.

Built with React, TypeScript and DeepSpace on Cloudflare Workers.

## Integrations

| Integration | Purpose |
| --- | --- |
| OpenAI | Suggest possible causes and next steps, with supporting quotes from the saved logs. |
| Exa | Find troubleshooting resources using a search query you review and confirm. |
| Gmail | Send a saved report with the analysis, investigation findings, and references after you review and confirm it. |

All three integrations run through DeepSpace and use the signed-in user's credits. Preparing or previewing a report or email draft does not call these services. AI suggestions and search results help with the investigation; people decide what the evidence supports.

## Run locally

You need Node.js 24, npm 11.6 or later, and a DeepSpace account with access to this app.

```bash
git clone https://github.com/lilyyang1014/IncidentDesk.git
cd IncidentDesk
npm ci
npm run login
npm run dev
```
