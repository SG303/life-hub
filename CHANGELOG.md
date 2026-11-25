# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Life Hub v1: German PWA with the views Heute, Aufgaben, Feeds, Chat and Quellen, served from a single Node.js container with embedded SQLite.
- Tasks with note, civil due date (evaluated in `TZ`), list and status filters.
- RSS/Atom feed reader for News, YouTube and Podcasts: YouTube channel URL resolution, OPML import, automatic refresh every 30 minutes plus manual refresh, first-subscribe unread cap, 30-day retention without resurrecting pruned items, SSRF protection.
- Chat with any OpenAI-compatible agent configured via environment variables, persistent threads, **Agent fragen** snapshots and a German error state with retry.
- Read-only MCP endpoint on its own port with bearer-token authentication for the agent.
- Daily and pre-migration SQLite backups, Docker image with health check and `compose.yaml`.
- CI (lint, typecheck, tests, build, Playwright end-to-end, Docker smoke test), workflow lint and Dependabot.
- Initial repository bootstrap on SG303 baseline v2.

### Fixed

- A malformed request target (such as `//`) no longer crashes the whole process; the UI and MCP ports answer `400`.
- With `MCP_EXPOSE_TASK_NOTES=false`, the MCP `search` tool no longer matches text that only appears in task notes.
- Pruned feed items no longer come back as unread after 180 days: seen-item tombstones are now kept until the source is deleted.
- Feed fetches now have a total deadline across all redirects, so one slow feed can no longer stall every refresh.
