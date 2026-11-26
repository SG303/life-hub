# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-11-26

### Changed

- **Heute** merges «Heute fällig» and «Als Nächstes» into one compact **Aufgaben** card grouped into **Überfällig**, **Heute** and **Demnächst** (up to three upcoming tasks). Each task is a single line with the due date, or else its list, on the right; tasks without a due date or list show nothing there. «Agent fragen» is no longer offered on these rows (still available in **Aufgaben**).

## [0.7.0] - 2026-11-25

### Added

- Mobile swipe triage across **Feeds**, **Aufgaben** and **Chat**: swipe right for the primary triage action (mark feed item read/unread, complete/reopen task, settle/reactivate chat) with a floating 5-second «Rückgängig» bar above the dock; swipe left to reveal two tap actions (**Merken** / **Aufgabe** on Feeds, **Bearbeiten** / **Löschen** with confirmation on Tasks, **Schlummern** or **Aufwecken** / **Anheften** or **Lösen** on Chat).
- Convert feed entries into tasks: the new **Aufgabe** action (in the left-swipe tray and as a regular button on each feed entry) opens the prefilled **Neue Aufgabe** sheet with the entry title and source/link note and marks the entry read on save.

## [0.6.0] - 2026-11-25

### Added

- Home-screen shortcuts for the installed app: a long press on the Life Hub icon (Android) offers «Neuer Chat», «Neue Aufgabe» and «Feeds». `/aufgaben?neu` opens the new-task form directly.

## [0.5.0] - 2026-11-25

### Added

- Real-time SSE chat streaming: replies from the external agent now stream incrementally into the chat view (with automatic fallback for non-streaming agents), keep running on the server across reloads or chat switches with seamless reconnect, and pause auto-scroll when scrolling up manually.
- Live and persisted MCP tool trace: while the agent works, Life Hub shows concise German summaries of its MCP reads (plus optional OpenAI SSE tool-call events) and saves the trace collapsed on the completed reply.
- `GET /api/v1/chat/threads/:id/stream` (SSE) and optional `async: true` mode on `POST /api/v1/chat/threads/:id/messages` and `/retry`.

## [0.4.0] - 2026-11-25

### Added

- Chat list modelled on T3 Code: chats are grouped into Angeheftet, Aktiv, Schlummernd and Erledigt. The ⋯ menu pins, snoozes (in 1 or 3 hours, today 18:00, tomorrow 09:00, Monday 09:00 or a custom time), settles, reactivates, renames and deletes a chat. Chats without activity for 7 days settle automatically unless pinned or set to «nie»; a new message brings a chat back to Aktiv, and a chat that woke from its snooze is marked «Wieder da».
- `PATCH /api/v1/chat/threads/:id` for title, pin, snooze, settle and auto-settle.
- A long press on the agent button in the dock opens a new chat right away (with a short vibration on Android); a short tap still opens the chat list.

### Changed

- On phones a chat opens full screen without the dock, with a back arrow, the model and its status dot in the header, and the composer at the very bottom. The intro text and the «Strg+Enter sendet» hint are gone (Ctrl+Enter still sends). Wide screens show the list and the chat side by side.
- «Neue Aufgabe», «Neue Quelle» and «Neuer Chat» share one compact olive button style; the Feeds refresh button and «OPML importieren» match their height.

## [0.3.0] - 2026-11-25

### Changed

- Heute drops the date and weekday so the tasks move up; the agent badge shows only «Agent» with a coloured dot for its state.
- Aufgaben and Feeds create tasks and sources through a small sheet opened by **Neue Aufgabe** / **Neue Quelle** in the page header; Feeds refreshes with a round icon button next to the title, and the Ungelesen and Gemerkt filters share one row with «Alle gelesen».
- The **Quellen** tab became **Mehr**: source management (edit, delete, OPML import) plus version and agent info. `/quellen` redirects to `/mehr`.

## [0.2.0] - 2026-11-25

### Added

- Every release publishes its container image to GHCR as `ghcr.io/sg303/life-hub:X.Y.Z` and `:X.Y`, so updating no longer needs the source code or a local build.

### Changed

- `compose.yaml` runs the image for `LIFE_HUB_VERSION` from `.env` (now required) and pulls it from GHCR; `docker compose up -d --build` still builds it from source.

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

[Unreleased]: https://github.com/SG303/life-hub/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/SG303/life-hub/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/SG303/life-hub/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/SG303/life-hub/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/SG303/life-hub/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/SG303/life-hub/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SG303/life-hub/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SG303/life-hub/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SG303/life-hub/releases/tag/v0.1.0
