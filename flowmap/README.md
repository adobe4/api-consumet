# FlowMap

A living map of your "success system". Every project (YouTube channel, TikTok account, app, website, sales channel…) is a **tank**. Pipes carry **money, attention, customers and progress** between them as animated particles. Neglect a project and its liquid drains, cracks appear and the flow slows. Water it (post, promote, improve) and the pipes you aimed at surge.

Built around a creator ecosystem (Vinei TV, Blonxin, TikTok, AI Mikeka, Domosauti, DigitalSoko, WhatsApp IPTV) but fully customizable, so a team or company can model its own.

## Run it

Needs **Node 22.5+**. No dependencies to install.

```bash
cd flowmap
npm start            # http://localhost:8787
npm test             # engine + API tests
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database (`flowmap.db`) and the signing key live. **Put this on a persistent disk.** |
| `FLOWMAP_SECRET` | generated into `DATA_DIR/secret.key` | Signs login tokens (16+ chars) |
| `ALLOW_REGISTRATION` | `true` | Set to `false` after you create your account to close signups |

## Deploy (cloud database)

The database is a SQLite file, so host it anywhere that gives you a **persistent volume** (Render disk, Railway/Fly volume, a VPS). Serverless hosts with ephemeral disks (Vercel, Netlify functions) are not suitable. A `Dockerfile` is included:

```bash
docker build -t flowmap .
docker run -p 8787:8787 -v flowmap-data:/data -e DATA_DIR=/data -e FLOWMAP_SECRET=change-me-to-a-long-random-string flowmap
```

## How the simulation works

- **Health (0-100)** rises when you act on a project (finish a task, log a post) and decays when you miss its rhythm ("needs a post every N days"). Below 50 it is *thirsty*, below 30 *dying*.
- **Flow level** follows health. The numbers you enter are the run-rate of a *healthy* project; a drying project makes less.
- **Each kind earns differently:** YouTube = views x ad revenue per 1,000 views (TZS); TikTok = attention only; apps, websites and sales channels = paying customers x price (monthly subscription or one-time), no visitor counts needed.
- **Pipes** move a share of a project's output into another: attention becomes views or customers there, money becomes fuel, progress speeds the receiver up. Pipes have a width, a monthly cost and a delay in days.
- **Watering** a project (finishing a task) creates a burst. Say how you feel about it (1-5), where you promoted it and which projects it pushed, and exactly those pipes surge, then fade over days.
- **Check-ins** (daily, or a whole month at once) calibrate the run-rates with your real numbers.
- **Timeline** scrubs 0-90 days ahead under three scenarios: planned tasks only, keep my pace, stop posting.

The engine is one pure module, `shared/engine.js`, used by both the browser and the server (`GET /api/report`).

## Layout

```
server/   index.js (HTTP + API), auth.js (scrypt + signed tokens), db.js (SQLite), models.js (validation)
shared/   engine.js (simulation), templates.js (starter worlds)
public/   index.html, css/app.css, js/ (renderer.js = Canvas 2D map, store.js, panels.js, dialogs.js, ...)
test/     engine + API tests
```

## API (all JSON, `Authorization: Bearer <token>`)

`POST /api/auth/register|login` · `GET /api/world` · `GET /api/report?horizon=30&scenario=keep` · CRUD on `/api/projects`, `/api/links`, `/api/tasks` · `POST /api/logs` (upsert per project and day) · `POST /api/logs/spread` · `GET /api/world/export` · `POST /api/world/import`
