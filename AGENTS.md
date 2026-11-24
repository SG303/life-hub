# life-hub

Personal, single-user self-hosted daily cockpit (mobile-friendly PWA web app) combining tasks, RSS/Atom feeds (News, YouTube, Podcasts), and a swappable external AI agent over OpenAI-compatible chat and MCP. Runs as a single Docker container on a headless home server over private LAN and Tailscale. Private repository on GitHub (`SG303/life-hub`).

Follows the SG303 baseline v2 (`sgstack/global/AGENTS.md`,
`sgstack/baseline/tools.md`). If you cannot read those: work on a branch,
open a PR, merge only with green checks (squash); never commit secrets or
personal data; English for everything in the repo; talk to me in German.

## Commands

Repository is freshly bootstrapped (application code not yet scaffolded; update these commands in the first implementation PR):

- Setup: `npm ci` (planned)
- Test: `npm test` (Vitest, planned) and `npm run test:e2e` (Playwright, planned)
- Lint and typecheck: `npm run lint` / `npm run typecheck` (ESLint flat config + `tsc`, planned)
- Run locally: bind UI/API server to `0.0.0.0` (never `localhost`) and MCP endpoint on dedicated `MCP_PORT`

## Release

Semantic Versioning (`vX.Y.Z`) with `CHANGELOG.md` (Keep a Changelog). No automated release script yet; update this section when a release workflow is added.

## Conventions

- **Single-user, private network only:** No in-app login or user management in v1; intended for private LAN and Tailscale access only (HTTPS via Tailscale Serve or reverse proxy with `TRUSTED_PROXIES` for Android PWA installation).
- **UI language vs. repo language:** All user-facing UI strings are German using Swiss spelling (`ss`, never `ß`). Code, comments, identifiers, commits, PRs, issues, and documentation are English.
- **API-first modularity:** The web UI talks exclusively to `/api/v1/*` JSON endpoints so a future native Android app can reuse the same backend contract. Keep domains (`tasks`, `feeds`, `chat`, `cockpit`) isolated behind public module interfaces.
- **Agent isolation & swappability:** External AI agent configuration is strictly via environment variables (`AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS`), never stored in SQLite or exposed to browsers. The stateless Streamable HTTP `/mcp` endpoint listens on its own `MCP_PORT`, fails closed when `MCP_AUTH_TOKEN` is unset or shorter than 32 characters, and exposes only read-only bounded tools in v1.
- **Persistence:** Embedded SQLite inside a persistent `/data` directory (WAL mode, foreign keys enabled, busy timeout, forward-only startup migrations, automatic pre-migration and daily online backups). Never commit `.env` files or database files.
- **Pending baseline files (empty repo):** Add `.github/dependabot.yml` and `.github/workflows/` (`ci.yml`, `workflow-lint.yml`, `dependabot-auto-merge.yml`) from `sgstack/baseline/templates/` as soon as `package.json` and `Dockerfile` are added.

## Deviations from baseline

none
