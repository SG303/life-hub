# life-hub

Personal, self-hosted daily cockpit (PWA) bringing together tasks, RSS/Atom feeds (News, YouTube, Podcasts), and a swappable external AI agent over OpenAI-compatible chat and MCP.

> [!NOTE]
> Personal project, built with AI coding agents under my supervision. Review the code carefully before you use it.

## Overview

`life-hub` is a single-user TypeScript (Node.js LTS) web application backed by embedded SQLite and designed for private LAN and Tailscale self-hosting. It provides a German-language daily cockpit (`Heute`, `Aufgaben`, `Feeds`, `Chat`, `Quellen`) alongside a dedicated, token-protected read-only MCP endpoint so an external agent (such as Hermes Agent) can access personal context without coupling the hub to a specific agent implementation.

## Setup

This repository is freshly bootstrapped on the SG303 baseline v2. Setup, configuration, and Docker Compose instructions will be added alongside the initial v1 implementation (see Issue #1).

## Status

Personal project, built with AI coding agents under my supervision. There is
no support and no stability guarantee; review the code carefully before you
rely on it. See [LICENSE](LICENSE) for the warranty terms.

## License

[MIT](LICENSE)
