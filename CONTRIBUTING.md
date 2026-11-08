# Contributing

Thanks for helping improve feishu-orgwatch. Bug reports, focused fixes, tests, documentation and feature proposals are welcome; read the [README](./README.md) for setup and usage first.

## Issues

Search existing issues before opening a new one. Use the [bug report](./.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](./.github/ISSUE_TEMPLATE/feature_request.md) template and include the exact version, deployment mode and steps to reproduce. For changes that affect the data model, permissions or update flow, open an issue before writing code.

## Development

Requirements: macOS or Linux, Git, Bash, Node.js **22.12+**, and npm 10+. Install Python 3, make and a C/C++ toolchain if the SQLite native dependency has no prebuilt binary.

Install dependencies:

```bash
npm ci
```

Start the backend and Vite:

```bash
./run.sh --dev
```

The API listens on port `18080` and the frontend on <http://127.0.0.1:5173>. The first start creates `feishu-orgwatch.properties`, `data/` and `.runtime/`, and creates the default administrator `hawkon`. A random initial password is written to `.runtime/default-admin.txt` unless `bootstrap.admin-password` is set; change it before any shared deployment.

Build the production artifacts:

```bash
npm run build
```

The server output is written to `apps/server/dist` and the frontend to `apps/web/dist`.

Feishu App ID and App Secret are runtime configuration, not source code. Enter them in the Settings page and never commit `feishu-orgwatch.properties`.

Project layout:

- [`apps/server`](./apps/server): NestJS API, Feishu integration, snapshots, diffs, cards, tasks and authentication.
- [`apps/web`](./apps/web): React pages, UI components, PWA assets and client-side state.
- [`tools`](./tools): run, update, backup, service-management and repository-audit scripts.
- [`docs`](./docs): Feishu app setup and the OpenAPI specification.

## Validation

Run the same checks as the [Checks workflow](./.github/workflows/checks.yml) before opening a pull request:

```bash
npm ci
npm run audit:repository
npm run check
bash -n run.sh stop.sh tools/*.sh
git diff --check
```

`npm run check` runs ESLint, TypeScript type checks, server and frontend unit tests, the production build and the repository audit. Run the optional end-to-end smoke test against a working local instance:

```bash
npm run test:e2e
```

Documentation-only changes may skip the production build, but state that in the pull request. Changes to the UI, permissions, update flow or scripts must also be exercised manually and the tested scenario described in the pull request.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit message and pull request title:

```text
type(scope): summary
```

- **English is required** for the entire title, including the scope and summary.
- **A scope is required**. Start it with a lowercase English letter and use only lowercase English letters, digits, and hyphens.
- **The entire commit message must be a single title line**. Do not add a body, footers, trailers, or a second `-m` argument.
- **The complete title must be 72 characters or fewer**, including the type, scope, spaces, and punctuation.
- Keep the type and scope lowercase. Start the summary with a lowercase imperative verb, such as `add`, `fix`, `remove`, `update`, or `document`.
- Proper names and technical identifiers in the summary may retain their original capitalization, such as `Android`, `GitHub`, `SDK`, and `JAVA_HOME`.
- Do not end the title with a period or whitespace, and do not use emoji.
- Keep each commit focused on one logical change. Describe the actual change; avoid vague summaries such as `update code` or `fix bug`.
- For an incompatible change, put `!` after the scope and before the colon: `type(scope)!: summary`.
- Put context, issue references, validation details, and migration notes in the pull request description.
- Apply the same rules to pull request titles and final squash-merge commit messages. When squash-merging, keep only the title and remove any automatically generated body or trailers.

Use one of these types:

| Type | Use for |
| --- | --- |
| `feat` | New user-visible functionality |
| `fix` | Bug, regression, or compatibility fixes |
| `refactor` | Code restructuring without behavior changes |
| `ui` | Visual styling or interaction adjustments |
| `perf` | Performance improvements |
| `docs` | Documentation changes |
| `test` | Test additions or updates |
| `build` | Build configuration, dependencies, tooling, or packaging |
| `ci` | CI workflows and automation |
| `chore` | Maintenance that fits no other type |
| `revert` | Reverting an earlier commit |

Use `feat` for new functionality and `fix` for defects, including changes to the UI. Use `ui` for other visual or interaction adjustments.

Preferred scopes:

| Scope | Area |
| --- | --- |
| `auth` | Local login, Feishu OAuth, sessions, RBAC and login protection |
| `directory` | Snapshots, department tree and people queries |
| `diff` | Diff engine, tracked fields, filters and exports |
| `inform` | Recipient selection, Feishu cards, retries and acknowledgements |
| `tasks` | Scheduled patrols, cron validation, runs and catch-up |
| `settings` | Configuration, encrypted secrets and connection testing |
| `system` | Status, updates, logs and health checks |
| `web` | React pages, UI components, PWA and client-side state |
| `build` | Build configuration, dependencies, tooling, and packaging |
| `ci` | CI workflows and automation |
| `docs` | README files and project documentation |
| `repo` | Repository-level configuration and contribution guidelines |

Prefer the scopes listed above. Use another concise scope only for a distinct area not covered by them, and keep it consistent. Tests should normally use the scope of the code they cover.

Examples:

```text
feat(system): add update console with live logs
fix(diff): compare all department leaders
docs(repo): document the contribution workflow
feat(auth)!: require csrf header on mutations
```

## Pull requests

- Keep one pull request focused on one problem and target the `main` branch.
- Explain the problem, the resulting behavior and any compatibility impact; link the related issue.
- Add or update tests for behavior changes, list the checks you ran, and declare the license compatibility of any new dependency.
- Include a screenshot or short recording for visible UI changes.
- Update the Chinese and English documentation when configuration or behavior changes, and keep both versions aligned.
- Do not commit `feishu-orgwatch.properties`, `data/`, `.runtime/`, SQLite files, backups, logs or credentials.
- Report security vulnerabilities through GitHub private vulnerability reporting or a private maintainer channel; do not publish exploit details in a public issue.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
