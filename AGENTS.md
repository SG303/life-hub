# life-hub

Personal, single-user self-hosted daily cockpit (mobile-friendly PWA web app) combining tasks, RSS/Atom feeds (News, YouTube, Podcasts), and a swappable external AI agent over OpenAI-compatible chat and MCP. Runs as a single Docker container on a headless home server over private LAN and Tailscale. Private repository on GitHub (`SG303/life-hub`).

Follows the SG303 baseline v2 (`sgstack/global/AGENTS.md`,
`sgstack/baseline/tools.md`). If you cannot read those: work on a branch,
open a PR, merge only with green checks (squash); never commit secrets or
personal data; English for everything in the repo; talk to me in German.

## Commands

Node.js 26 (`.nvmrc`; keep in sync with the `Dockerfile` base image and CI).

- Setup: `npm ci`
- Build: `npm run build` (server via `tsc` to `dist/server`, web via Vite to `dist/web`)
- Lint and typecheck: `npm run lint` (ESLint flat config incl. module-boundary rules) / `npm run typecheck` (`tsc` + `svelte-check`)
- Unit/integration tests: `npm test` (Vitest)
- End-to-end: `npm run build && npm run test:e2e` (Playwright, desktop + 390px mobile behind a local HTTPS proxy; `E2E_APP=docker` runs against the `life-hub:test` image)
- Docker smoke test: `./scripts/docker-smoke.sh`
- Prepare a release: `npm run release -- <major|minor|patch>` (see Release)
- Local harness (fixture feeds, fake YouTube, mock agent, app, HTTPS proxy): `npm run harness`
- Run locally: `npm run dev` binds UI/API to `0.0.0.0:3000` and MCP to `0.0.0.0:3001` (set `ALLOWED_HOSTS` to the LAN/Tailscale address you use)

## Release

Semantic Versioning (`vX.Y.Z`) with `CHANGELOG.md` (Keep a Changelog). `package.json` holds the version; `/api/v1/health` and the MCP server report it. While the version is 0.x, a MINOR bump means new features or a breaking change, a PATCH bump fixes only.

1. Every pull request with user-visible changes (entries under `## [Unreleased]`) also releases them: run `npm run release -- <major|minor|patch>` in that branch. It moves `[Unreleased]` into a dated section, updates the compare links and bumps `package.json` and `package-lock.json`. Commit the three files with the change.
2. After the merge, the `release` job in `.github/workflows/ci.yml` waits for all CI jobs on `main`, then creates the tag `v<version>` on the merge commit and a GitHub release with the changelog section as notes (`npm run release -- notes` prints them). Verify that this job succeeded.
3. Never create, move or reuse tags or releases by hand. A version is released once; if the job finds the tag already, it does nothing.

`test/release.test.ts` fails when `package.json`, `package-lock.json` and `CHANGELOG.md` disagree about the current version. Deployment stays with the owner (see "Updating" in README.md).

## Conventions

- **Single-user, private network only:** No in-app login or user management in v1; intended for private LAN and Tailscale access only (HTTPS via Tailscale Serve or reverse proxy with `TRUSTED_PROXIES` for Android PWA installation).
- **UI language vs. repo language:** All user-facing UI strings are German using Swiss spelling (`ss`, never `ß`). Code, comments, identifiers, commits, PRs, issues, and documentation are English.
- **API-first modularity:** The web UI talks exclusively to `/api/v1/*` JSON endpoints so a future native Android app can reuse the same backend contract. Keep domains (`tasks`, `feeds`, `chat`, `cockpit`) isolated behind public module interfaces.
- **Agent isolation & swappability:** External AI agent configuration is strictly via environment variables (`AGENT_BASE_URL`, `AGENT_API_KEY`, `AGENT_MODEL`, `AGENT_TIMEOUT_MS`), never stored in SQLite or exposed to browsers. The stateless Streamable HTTP `/mcp` endpoint listens on its own `MCP_PORT`, fails closed when `MCP_AUTH_TOKEN` is unset or shorter than 32 characters, and exposes only read-only bounded tools in v1.
- **Persistence:** Embedded SQLite inside a persistent `/data` directory (WAL mode, foreign keys enabled, busy timeout, forward-only startup migrations, automatic pre-migration and daily online backups). Never commit `.env` files or database files.
- **Layout:** `src/core` (database, HTTP, security), `src/modules/<domain>` (each exposes only `index.ts`; enforced by ESLint `no-restricted-imports`), `src/mcp` (MCP endpoint), `web/` (Svelte 5 PWA), `test/` (Vitest, fixtures, harness), `e2e/` (Playwright).
- **Schema changes:** add a new numbered entry to `src/core/migrations.ts`; never edit a released migration.
- **Untrusted content:** feed text is stored as plain text and rendered escaped; assistant replies go only through `web/src/lib/markdown.ts` (no raw HTML, no images, `http(s)` links only). Keep the CSP strict (no inline scripts/styles, no data: fonts).
- **Tests without internet:** all tests use local fixtures and the mock agent; never depend on live feeds, YouTube or a real agent.

## Deviations from baseline

none
