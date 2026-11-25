# life-hub

Personal, self-hosted daily cockpit (PWA) bringing together tasks, RSS/Atom feeds (News, YouTube, Podcasts), and a swappable external AI agent over OpenAI-compatible chat and MCP.

> [!NOTE]
> Personal project, built with AI coding agents under my supervision. Review the code carefully before you use it.

## Overview

`life-hub` is a single-user TypeScript (Node.js LTS) web application backed by embedded SQLite and designed for private LAN and Tailscale self-hosting. The UI is German (Swiss spelling) and installable as a PWA over HTTPS.

| View | What it does |
| --- | --- |
| **Heute** | Overdue and due-today tasks (evaluated in `TZ`), the next open tasks, and the newest unread News, Videos and Podcasts (bounded per type). |
| **Aufgaben** | Create, edit, check off, delete and filter tasks (title, note, `YYYY-MM-DD` due date, list). |
| **Feeds** | Unified reader: filter by type, unread and `Gemerkt`; toggle read/bookmark; items open the original `http(s)` link (no embedded player). Excerpts are plain text. |
| **Chat** | Chat with any OpenAI-compatible agent configured via environment variables. Threads are stored in Life Hub. **Agent fragen** on any task or feed item opens the composer with a visible, bounded snapshot. |
| **Quellen** | Add/edit/remove RSS/Atom feeds and YouTube channels (`/channel/UC…`, `@handle`, `/c/…`, `/user/…` are resolved to the channel RSS feed), and import OPML. |

The agent reads Life Hub through a separate, token-protected **MCP endpoint** (stateless Streamable HTTP, read-only tools `list_tasks`, `get_task`, `list_feed_items`, `get_feed_item`, `search`).

## Setup

Requirements: Docker with Compose, a host in your private network (LAN/Tailscale).

```sh
cp .env.example .env
# edit .env: ALLOWED_HOSTS, AGENT_*, and a token: openssl rand -hex 32 -> MCP_AUTH_TOKEN
docker compose up -d --build
```

- Web app and `/api/v1`: `http://<host>:3000` (no login: keep it on the private network).
- MCP endpoint for the agent: `http://<host>:3001/mcp` with `Authorization: Bearer <MCP_AUTH_TOKEN>`.
- Data, including daily backups in `/data/backups`, lives in the `life-hub-data` volume.

### HTTPS and PWA installation (Android)

Android only installs PWAs over HTTPS. The default path is Tailscale Serve on the Docker host:

```sh
tailscale serve --bg 3000
```

Then add the Serve host name (for example `life-hub.example.ts.net`) to `ALLOWED_HOSTS` and keep the Docker bridge in `TRUSTED_PROXIES` (default in `.env.example`) so `X-Forwarded-Proto`/`X-Forwarded-Host` are honoured. Any other reverse proxy works the same way. Plain HTTP on the LAN works as a normal browser tab.

With Docker port publishing every client, not only the proxy, reaches the container from the Docker bridge. Life Hub therefore checks the `Host` header itself against `ALLOWED_HOSTS` as well as `X-Forwarded-Host`, so a forged forwarded header cannot get past the DNS-rebinding protection. A reverse proxy must either pass the original `Host` through or send a loopback name (`127.0.0.1`, `localhost`) or another name listed in `ALLOWED_HOSTS`.

### Agent (for example Hermes Agent)

| Direction | Setting |
| --- | --- |
| Life Hub → agent chat | `AGENT_BASE_URL` (OpenAI-compatible base URL including `/v1`), `AGENT_API_KEY`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS` (default 120000) |
| Agent → Life Hub data | MCP server URL `http://<life-hub-host>:3001/mcp`, header `Authorization: Bearer <MCP_AUTH_TOKEN>` |

Allow the agent VM to reach only port `3001`, never `3000` (Tailscale ACLs, Proxmox firewall or `DOCKER-USER`; published Docker ports bypass `ufw`). The MCP tools are read-only, but the UI API on `3000` has no login.

Privacy: tasks and feed items the agent reads may be sent to the LLM provider the agent uses. Set `MCP_EXPOSE_TASK_NOTES=false` to hide task notes from the agent.

### Configuration

All settings are environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `MCP_PORT` | `3000` / `3001` | UI/API listener and MCP listener (both bind `0.0.0.0`). |
| `LIFE_HUB_BIND` / `MCP_BIND` | `0.0.0.0` | Docker Compose only: host address the UI/API and MCP ports are published on (for example a Tailscale IP). |
| `ALLOWED_HOSTS` | – | Host names the browser may use (DNS-rebinding protection). Loopback is always allowed. |
| `TRUSTED_PROXIES` | – | IPs/CIDRs whose `X-Forwarded-*` headers are trusted. |
| `TZ` | `Europe/Zurich` | Time zone for due dates. |
| `MCP_AUTH_TOKEN` | – | Bearer token (≥ 32 characters). Unset or shorter: `/mcp` answers `503`. |
| `MCP_ALLOWED_ORIGINS` | – | Browser origins allowed on `/mcp` (agents usually send none). |
| `MCP_EXPOSE_TASK_NOTES` | `true` | Include task notes in MCP results. |
| `AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL` | – | OpenAI-compatible chat endpoint. Never stored in the database or sent to the browser. |
| `AGENT_TIMEOUT_MS` | `120000` | Timeout per chat turn. |
| `AGENT_MAX_HISTORY_MESSAGES` / `AGENT_MAX_HISTORY_CHARS` | `20` / `24000` | History sent per request. |
| `FEED_REFRESH_INTERVAL_MS` | `1800000` | Automatic feed refresh (overdue feeds are caught up at startup). |
| `ALLOW_PRIVATE_FEED_URLS` | `false` | Allow feeds on loopback/LAN/Tailscale addresses (blocked by default against SSRF). |
| `FEED_RETENTION_DAYS` | `30` | Read, non-bookmarked items older than this (since fetch) are pruned daily. |
| `BACKUP_KEEP` | `7` | Number of daily and pre-migration backups to keep. |
| `DATA_DIR` | `data` (`/data` in Docker) | SQLite database and backups. |

### Backup and restore

Life Hub writes a daily online backup (`VACUUM INTO`) and a backup before every schema migration to `/data/backups`. To restore:

1. `docker compose stop life-hub`
2. In the data volume, delete `life-hub.db`, `life-hub.db-wal` and `life-hub.db-shm`.
3. Copy the backup file to `life-hub.db` (use the matching older image when rolling back a migration).
4. `docker compose start life-hub`

Also keep a copy of `.env` outside Git.

## Development

Node.js 26 (see `.nvmrc`), npm.

```sh
npm ci
npm run build        # server (tsc -> dist/server) and web app (Vite -> dist/web)
npm run dev          # build and start on 0.0.0.0:3000 / :3001
npm run lint         # ESLint, including module-boundary rules
npm run typecheck    # tsc + svelte-check
npm test             # Vitest unit and integration tests
npm run test:e2e     # Playwright, desktop and 390px mobile, behind a local HTTPS proxy
E2E_APP=docker npm run test:e2e   # same against the life-hub:test image
./scripts/docker-smoke.sh         # builds the image and checks user, health, ports, persistence
npm run harness      # fixture feeds, fake YouTube, mock agent, Life Hub and HTTPS proxy until Ctrl+C
```

The test harness (`test/harness`) runs without internet access or a real agent: it serves deterministic feeds (including XSS and prompt-injection payloads), a fake YouTube host, and a mock OpenAI-compatible agent that calls Life Hub's `/mcp` during each chat turn.

### Structure

```text
src/
  server.ts, app.ts, config.ts   entry point, composition, configuration
  core/                          SQLite, migrations, backups, HTTP router, security headers
  modules/{tasks,feeds,chat,cockpit}/  domains; others import only their index.ts
  mcp/                           MCP endpoint and read-only tools
web/                             Svelte 5 PWA (talks only to /api/v1)
test/                            Vitest tests, fixtures and the local harness
e2e/                             Playwright tests
```

## Status

Personal project, built with AI coding agents under my supervision. There is
no support and no stability guarantee; review the code carefully before you
rely on it. See [LICENSE](LICENSE) for the warranty terms.

## License

[MIT](LICENSE)
