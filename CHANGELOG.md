# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-25

### Added

- Life Hub v1: German PWA with the views Heute, Aufgaben, Feeds, Chat and Quellen, served from a single Node.js container with embedded SQLite.
- Tasks with note, civil due date (evaluated in `TZ`), list and status filters.
- RSS/Atom feed reader for News, YouTube and Podcasts: YouTube channel URL resolution, OPML import, automatic refresh every 30 minutes plus manual refresh, first-subscribe unread cap, 30-day retention without resurrecting pruned items, SSRF protection.
- Chat with any OpenAI-compatible agent configured via environment variables, persistent threads, **Agent fragen** snapshots and a German error state with retry.
- Read-only MCP endpoint on its own port with bearer-token authentication for the agent.
- Daily and pre-migration SQLite backups, Docker image with health check and `compose.yaml`.
- CI (lint, typecheck, tests, build, Playwright end-to-end, Docker smoke test), workflow lint and Dependabot.
- Initial repository bootstrap on SG303 baseline v2.
- Versioned releases: every version gets a git tag `vX.Y.Z` and a GitHub release with its changelog section; `/api/v1/health` reports the running version.

### Changed

- New look: dark grey with an olive accent (light and dark follow the system), Bricolage Grotesque as the typeface and a new app icon.
- Navigation is a floating dock on every screen size, with the agent (Chat) in the middle.
- Heute: today's and overdue tasks share one «Heute fällig» panel (overdue ones carry an ochre badge), and new feed entries appear as cards you can swipe through on the phone and bookmark directly.

### Fixed

- A malformed request target (such as `//`) no longer crashes the whole process; the UI and MCP ports answer `400`.
- With `MCP_EXPOSE_TASK_NOTES=false`, the MCP `search` tool no longer matches text that only appears in task notes.
- Pruned feed items no longer come back as unread after 180 days: seen-item tombstones are now kept until the source is deleted.
- Feed fetches now have a total deadline across all redirects, so one slow feed can no longer stall every refresh.
- Chat: switching to another chat while the agent is still answering no longer shows the reply in the wrong chat or sends the next message to the wrong thread.
- The `Host` header is now checked against `ALLOWED_HOSTS` as well as `X-Forwarded-Host`. Behind Docker port publishing every client arrives from the bridge, so a forged forwarded header could bypass the DNS-rebinding protection for reads.
- Malformed `TRUSTED_PROXIES` entries (such as `10.0.0.1/`, which used to mean "trust everyone") now stop the startup with an error.
- Heute: feed entries now offer **Agent fragen** like everywhere else.
- Feeds: "Weitere laden" no longer skips entries after marking items read or unbookmarking them under a filter, and a slow response can no longer overwrite the result of a newer filter.
- Aufgaben: deleting a task now asks for confirmation, like deleting a source.
- `compose.yaml` publishes the ports configured in `PORT`/`MCP_PORT`; `LIFE_HUB_BIND` and `MCP_BIND` are documented.
- YouTube channel resolution only accepts pages from YouTube hosts and no longer follows redirects elsewhere.
- Feed fetching drops cookies and cache validators when a redirect leaves the original origin, and rejects invalid redirect targets cleanly.
- SSRF protection checks the IPv4 address inside NAT64 addresses (`64:ff9b::/96`) and blocks the local-use NAT64 range.
- OPML import skips feed URLs that contain a user name or password.

[Unreleased]: https://github.com/SG303/life-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SG303/life-hub/releases/tag/v0.1.0
