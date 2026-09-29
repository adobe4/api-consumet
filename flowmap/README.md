# FlowMap

A living 3D map of your "success system". Every project (YouTube channel, TikTok account, app, website, sales channel…) is a glass **tank** of glowing liquid. Glass pipes carry **money, attention, customers and progress** between them. Neglect a project and its liquid drains, cracks appear, smoke rises and the flow slows. Post, promote or improve it and the pipes you aimed at surge.

- **Runs on the real clock.** Through the day each tank drifts toward where it will be tomorrow if you do nothing; the top bar counts what has come in so far today. The timeline shows the next 90 days under three scenarios.
- **Channel links scan themselves.** Add YouTube, TikTok, website or Play Store links to a project. Every morning FlowMap reads them: uploads count as posts (which keep the project healthy) and view growth becomes attention.
- **An AI brain.** Connect Claude, ChatGPT or any MCP agent with a private link, or give FlowMap your own AI key for a built-in daily review. The brain reads the whole system, adjusts numbers and pipes, writes notes and gives you tasks.

Built around a creator ecosystem (Vinei TV, Blonxin, TikTok, AI Mikeka, Domosauti, DigitalSoko, WhatsApp IPTV) but fully customizable.

## Run it locally

Needs **Node 22+**.

```bash
cd flowmap
npm install
npm start            # http://localhost:8787 (SQLite file in ./data)
npm test
```

## Deploy on Vercel with Turso (both free)

The API is one Vercel function (`api/index.js`); the database is [Turso](https://turso.tech), free hosted SQLite.

1. Create a Turso database (turso.tech → Databases → Create). Copy its **URL** (`libsql://…`) and create a **token**.
2. In the Vercel project → Settings → Environment Variables, add:

| Variable | Required | What it is |
|---|---|---|
| `TURSO_DATABASE_URL` | yes | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | yes | the database token |
| `FLOWMAP_SECRET` | yes | 16+ random characters; signs logins and encrypts stored AI keys. Changing it signs everyone out and makes saved AI keys unreadable |
| `CRON_SECRET` | yes | random string; Vercel sends it to the daily job |
| `YOUTUBE_API_KEY` | no | exact YouTube numbers for every account (each user can also add their own key in Settings) |
| `ALLOW_REGISTRATION` | no | set to `false` after creating your account to close sign-ups |

3. Redeploy. `vercel.json` sets the build (`scripts/build.mjs` → `dist/`), the API rewrite and a daily cron at 04:00 UTC (07:00 in Tanzania) that scans every channel and runs the built-in AI for users who turned it on.

Locally, the same Turso variables make `npm start` use the cloud database instead of the file.

## Connect an AI agent

In the app: **🧠 Brain → Connect an outside AI agent → Create connection link**. The link (`https://<your-site>/api/mcp/fm_…`) is an MCP server (Streamable HTTP):

- **Claude / claude.ai:** Settings → Connectors → Add custom connector → paste the link.
- **Claude Code:** `claude mcp add --transport http flowmap <link>`
- **ChatGPT:** Settings → Connectors (developer mode) → Create → paste the link.
- **Anything else:** call the REST API with `Authorization: Bearer fm_…`.

Tools: `get_overview`, `get_project`, `create_task`, `update_task`, `adjust_project`, `set_pipe`, `create_project`, `log_numbers`, `add_note`, `scan_channels`. Agent keys cannot change the account, passwords or other keys. Disconnect a key to cut its access immediately.

## How the simulation works

- **Health (0-100)** rises when you act on a project (finish a task, log or scan a post) and decays when you miss its rhythm. Below 50 it is *thirsty*, below 30 *dying*. Unfinished tasks only shape the forecast, never today.
- **Flow level** follows health. The numbers you enter are the run-rate of a *healthy* project.
- **Each kind earns differently:** YouTube = views × ad revenue per 1,000 views (TZS); TikTok = attention; apps, websites and sales channels = paying customers × price.
- **Pipes** move a share of a project's output into another, with a width, a monthly cost and a delay.
- **Watering** (finishing a task) makes a burst; the pipes you aimed it at surge, then fade over days.
- **Logged and scanned numbers** from the last 14 days override the run-rates.

The engine is one pure module, `shared/engine.js`, used by both the browser and the server.

## Layout

```
api/      index.js (Vercel function)
server/   app.js (API routes), brain.js (AI tools, MCP, daily AI), scan.js + sync.js (channel scanning),
          auth.js, db.js (libSQL: file or Turso), models.js, index.js (local server)
shared/   engine.js (simulation), templates.js, sources.js (channel links), format.js
public/   index.html, css/app.css, js/ (renderer3d.js = three.js map, renderer.js = 2D fallback, store.js, panels.js, dialogs.js, brain-ui.js, …)
scripts/  build.mjs (Vercel static build), vendor.mjs (three.js for the browser)
demo/     static demo build that runs without a server
test/     engine, API, scanner and MCP tests
```
