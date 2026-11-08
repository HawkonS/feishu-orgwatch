# Feishu OrgWatch (feishu-orgwatch)

<p align="center">
  <img src="./apps/web/public/logo.svg" height="112" alt="Feishu OrgWatch icon" />
</p>

<p align="center">
  Turn Feishu org changes into a traceable acknowledgement loop
</p>

<p align="center">
  <a href="./README.md">中文</a> ·
  English
</p>

<p align="center">
  <a href="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/checks.yml"><img src="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/checks.yml/badge.svg" alt="Checks" /></a>
  <a href="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/codeql-analysis.yml"><img src="https://github.com/HawkonS/feishu-orgwatch/actions/workflows/codeql-analysis.yml/badge.svg" alt="CodeQL" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
</p>

## Overview

Organization changes usually live in Feishu operation logs: someone joins, leaves or changes teams, or a department is renamed or gets a new leader. Checking manually is slow and easy to miss, and it is hard to prove who knew about a change and when.

feishu-orgwatch closes that gap: it captures directory snapshots on a schedule, compares each snapshot with the previous one, lets operators select the people who should know, sends Feishu cards, and records delivery and acknowledgement.

It is a self-hosted web service with a NestJS + Fastify backend, a React + Vite + TypeScript frontend, and a single SQLite database. The API and frontend share one port, which makes it suitable for a single-instance deployment inside a company network.

## Features

- **Directory snapshots**: fetch the department tree, people and employment status under a root department.
- **Field-level diffs**: compare tracked fields and ignore avatars, ordering and casing noise.
- **Inform cards**: pick people or group chats and send a Feishu card with a summary and deep link.
- **Automatic notifications**: enable automatic delivery to selected people or chats when a patrol finds a new diff.
- **Acknowledgement loop**: recipients confirm in the app, administrators can confirm on their behalf, and every step is audited.
- **Directory browsing**: browse departments and people, search, and inspect department paths and change history.
- **Scheduled patrols**: configure schedules, time zones, catch-up runs and run history visually.
- **Access and secrets**: enforce three roles in the UI and API, and encrypt the Feishu App Secret.
- **Operations**: PWA installation, in-app updates, live logs and snapshot backups.

## Quick start

Requirements: macOS or Linux, Git, Bash, Node.js **22.12+** and npm 10+. If the SQLite native dependency has no prebuilt binary, install Python 3, make and a C/C++ toolchain as well.

```bash
git clone https://github.com/HawkonS/feishu-orgwatch.git
cd feishu-orgwatch
./run.sh
```

Open <http://127.0.0.1:18080/login> and sign in as the default administrator `hawkon`; the first start generates a random initial password in `.runtime/default-admin.txt` together with `feishu-orgwatch.properties`, `data/` and `.runtime/`. Change it immediately, then configure the Feishu App ID and App Secret on the Settings page; see [Feishu app setup](./docs/feishu-app-setup.md).

Use **Test connection** first, then run a patrol. Stop the service with `./stop.sh`.

## Configuration

Configuration lives in `feishu-orgwatch.properties` at the repository root; it is generated on first start and missing keys are added automatically. Prefer the Settings page for routine changes, where every field has its own description and default. Environment variables use the `ORGWATCH_<KEY>` form; data lives in `data/` and logs in `.runtime/logs/`.

Environment variables named `ORGWATCH_<KEY>` override the file, for example `ORGWATCH_APP_PORT` overrides `app.port`. The properties file contains credentials and must not be committed. SQLite data, the encryption key and runtime logs live under `data/`, `data/secret.key` and `.runtime/`.

## FAQ

**The patrol fails or reports a permission error.**

Open Settings and run **Test connection**. Add the missing directory permissions and make sure the app's availability scope covers the root department.

**Feishu cards do not arrive.**

Check that the app is published, the bot has joined the target group, and the sender and recipient `open_id` values come from the same Feishu app.

**An acknowledgement does not match a person.**

Check how the platform account is linked to Feishu (union_id, open_id or email). An operations administrator can confirm on the recipient's behalf from the acknowledgement records.

**There are too many noisy changes.**

Disable **Track department ordering**, or ignore the diff with a reason on its detail page.

**I forgot the administrator password.**

```bash
./tools/reset_admin_password.sh
```

## Development

```bash
npm ci
./run.sh --dev
npm run check
```

Development mode starts the backend and Vite together. Open <http://127.0.0.1:5173> for the frontend; the API stays on port `18080`. `npm run check` covers lint, type checks, server and frontend tests, the build and the repository audit. Run `npm run test:e2e` for the end-to-end smoke test.

Enable the local commit hooks:

```bash
git config core.hooksPath .githooks
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for module boundaries, validation commands and commit message rules.

## Safety notes

- Feishu directory data, diffs, acknowledgements and audit records stay in the local SQLite database. The only external calls go to the Feishu Open Platform for directory access and card delivery, subject to its own terms of service.
- Do not commit `feishu-orgwatch.properties`, `data/`, `.runtime/`, backups or logs. Rotate the App Secret in the Feishu console if it is exposed.
- Changing `security.secret-key` makes existing encrypted Feishu credentials unreadable. Back up the database, the properties file and `data/secret.key` together.
- Before exposing the service to the internet, complete setup, use a strong password, enable HTTPS and put the service behind a trusted network or reverse proxy.
- Employee data is personal data. Use it only within the scope authorized by your organization, shorten snapshot retention when appropriate and delete data that is no longer needed.

## License

Copyright 2026 HawkonS.

This project is released under the [Apache License 2.0](./LICENSE).
