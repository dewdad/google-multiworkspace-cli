# multi-gws-cli (`gwcli`)

Multi-profile orchestration layer over the official **[`gws`](https://github.com/googleworkspace/cli)** CLI. Adds named profiles (like AWS CLI), per-profile credential isolation, and AI-agent-friendly defaults to Google Workspace's command-line tooling.

> **`gwcli` is a wrapper, not a reimplementation.** It does not call Google APIs directly — it spawns `gws` with the right credentials for the active profile. All Gmail / Calendar / Drive / Docs / Sheets / Keep / Tasks command surface comes from `gws` itself.

## Why this exists

The official `gws` CLI is excellent but ships with a single global credential store. If you have personal + work + client Google accounts, you have to manually swap config dirs every time. `gwcli` solves that:

- **Named profiles** — `gwcli --profile work …` / `GWCLI_PROFILE=work`, with a configurable default
- **Per-profile config isolation** — each profile gets its own `gws` config dir, so tokens never collide
- **AI-agent shipped as a skill** — bundled `skill/` folder ships a [skillshare](https://github.com/runkids/skillshare)-installable skill so Claude Code / OpenCode / Cursor can drive Google Workspace via the CLI (more context-efficient than MCP)
- **Native shortcuts** — high-traffic agent flows like `gwcli agenda` get first-class commands; everything else is a transparent passthrough to `gws`

## Dependencies

| Dependency        | Required at | Purpose                                         | How to get it          |
| ----------------- | ----------- | ----------------------------------------------- | ---------------------- |
| **Node.js ≥18**   | install     | runs the `gwcli` binary                         | https://nodejs.org/    |
| **`gws`** (`@googleworkspace/cli`) | runtime | does all real Google API work | `gwcli setup` (auto-installs globally), or `npm install -g @googleworkspace/cli` manually |
| Google OAuth client secret JSON | first profile add | per-Google-account auth | Google Cloud Console (see [Setup](#setup)) |

`gws` is **not** declared as an npm dependency, because it's a global CLI binary, not a library. `gwcli setup` installs it for you, and `gwcli doctor` / `gwcli preflight` verify it's on PATH. You can override the binary path in `<config-root>/config.json` → `gwsBinary` if you have a non-standard install.

## Installation

```bash
# 1. Install gwcli (from GitHub — requires git on PATH; npm runs `tsc` automatically via the `prepare` script)
npm install -g github:dewdad/multi-gws-cli

# 2. Install gws + create config dirs (idempotent)
gwcli setup

# 3. Verify
gwcli doctor
```

> **Not on the npm registry yet.** `gwcli` is installed directly from this GitHub repo. npm will clone, run `prepare` (`tsc`) to build `dist/`, then symlink the `gwcli` bin globally. Standard `npm update -g` re-pulls the default branch.

`gwcli setup` runs `npm install -g @googleworkspace/cli` for you and verifies the version meets the minimum (`0.20.0`). Re-run any time to repair an install. Add `--gws-version <ver>` to pin a specific `gws` version.

## Setup

### 1. Create a Google Cloud OAuth client (per Google account)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. **APIs & Services → Library** — enable each API you need (Gmail, Calendar, Drive, Docs, Sheets, Keep, Tasks)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **Desktop app**
6. Download the JSON

You can reuse one OAuth client across multiple `gwcli` profiles, or create one per account — both work.

### 2. Add a profile

```bash
gwcli profiles add personal --client ~/Downloads/client_secret_*.json
```

This opens a browser for OAuth consent. Tokens are stored under `<config-root>/profiles/personal/gws/` (isolated from any other profile and from any pre-existing global `gws` install).

By default all supported services are requested. To restrict scopes:

```bash
gwcli profiles add work --client ~/work-client.json --scopes gmail,calendar,drive
```

> **Scopes are immutable on a profile.** To change the scope set, `profiles remove` then `profiles add` again.

### 3. Set a default profile (optional)

```bash
gwcli profiles set-default personal
```

Profile resolution order: `--profile <name>` flag → `GWCLI_PROFILE` env var → configured default → error.

## Usage

`gwcli` has two command surfaces:

### A) Native commands (handled by `gwcli` itself)

| Command                    | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `gwcli profiles <action>`  | `list`, `add`, `remove`, `rename`, `set-default`, `auth`, `status`   |
| `gwcli agenda [--days N]`  | Profile-aware "what's on my calendar" shortcut                       |
| `gwcli setup`              | Install `gws` + create config dirs                                   |
| `gwcli preflight`          | Fast (<500ms) dependency check for agents (silent on success)        |
| `gwcli doctor`             | Detailed system health report                                        |
| `gwcli migrate`            | Migrate v1 profiles to the current layout                            |
| `gwcli version-info`       | Show `gwcli` and `gws` versions                                      |

### B) Passthrough to `gws`

Anything that isn't a native command is forwarded to `gws` with the active profile's credentials. The argument shape is `gws`'s — see [`gws` docs](https://github.com/googleworkspace/cli) for the full surface, or run `gwcli <service> --help`.

```bash
# Gmail
gwcli gmail users messages list --params '{"userId":"me","maxResults":20}'
gwcli gmail users messages get  --params '{"userId":"me","id":"<msg-id>"}'

# Calendar (or use the native shortcut: gwcli agenda --days 7)
gwcli calendar events list --params '{"calendarId":"primary","timeMin":"<ISO>","timeMax":"<ISO>"}'
gwcli calendar events insert --params '{"calendarId":"primary"}' --body '<event-json>'

# Drive
gwcli drive files list --params '{"pageSize":20}'
gwcli drive files export --params '{"fileId":"<id>","mimeType":"application/pdf"}'

# Keep, Tasks, Docs, Sheets — same router pattern, see gws docs
gwcli keep notes list --params '{"pageSize":25}'
gwcli tasks tasks list --params '{"tasklist":"@default"}'
```

> **Heads-up on Keep:** the Google Keep API is Workspace-only, so `gwcli keep …` returns `403 PERMISSION_DENIED` on personal `@gmail.com` accounts — the most common case. `gwcli` does not work around this; the `gws` error is the signal. For consumer Keep, see [`skill/references/keep.md`](skill/references/keep.md#consumer-keep-alternatives-personal-gmailcom) for unofficial community alternatives ([KeepSidian](https://github.com/lc0rp/KeepSidian) for Obsidian, [KIM](https://github.com/djsudduth/keep-it-markdown) standalone) — both live outside `gwcli`'s scope and trust boundary.

### Global flags

```bash
gwcli --profile work <cmd>     # one-off profile selection (alias: -p)
gwcli --format json <cmd>      # force JSON output (alias: -f). gws also supports table, yaml, csv
gwcli --verbose <cmd>          # log profile resolution + the full gws invocation to stderr
gwcli -- <raw-gws-args>        # explicit passthrough separator if a flag clashes with gwcli's
```

`--profile` / `--format` / `--verbose` are stripped before forwarding; everything else goes to `gws` verbatim.

## Configuration

Config root depends on platform:

- **Linux / macOS**: `~/.config/gwcli/`
- **Windows**: `%APPDATA%\gwcli\`
- **Override**: set `GWCLI_CONFIG_DIR=/some/path` (useful for tests / sandboxes)

```
<config-root>/
├── config.json              # global: defaultProfile, gwsBinary path, defaults
└── profiles/
    ├── personal/
    │   ├── meta.json        # display name, scopes, created-at
    │   └── gws/             # isolated gws config dir (tokens, oauth client, etc.)
    └── work/
        ├── meta.json
        └── gws/
```

`config.json` schema:

```json
{
  "version": 1,
  "defaultProfile": "personal",
  "gwsBinary": "gws",
  "settings": {
    "defaultFormat": "json",
    "annotateProfile": false
  }
}
```

Set `gwsBinary` to an absolute path if `gws` isn't on `PATH`, or to pin a specific install (e.g. `/usr/local/lib/node_modules/@googleworkspace/cli/run.js`).

## AI agent integration

This repo ships an AI skill at [`skill/SKILL.md`](skill/SKILL.md) that teaches Claude Code, OpenCode, Cursor, etc. how to drive `gwcli`. Install it via [skillshare](https://github.com/runkids/skillshare):

```bash
skillshare install multi-gws-cli
```

Or point your agent's skill loader at `skill/SKILL.md` directly. The skill includes a mandatory `gwcli preflight` step (silent on success, exit codes `60–69` on remediable issues) and full per-service references under `skill/references/`.

### Pre-approving for Claude Code

```json
{
  "permissions": {
    "allow": ["Bash(gwcli:*)"]
  }
}
```

### Direct shell use from any agent

```bash
gwcli gmail users messages list --params '{"userId":"me"}' --format json
gwcli agenda --days 7 --format json
gwcli drive files list --params '{"pageSize":20}' --format json
```

`gwcli profiles list` and other native commands auto-select JSON when stdout is piped (table when interactive). Pass `--format json` to force it.

## Troubleshooting

| Symptom                          | Cause                                        | Fix                                           |
| -------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `gws binary not found`           | `gws` not installed / not on PATH            | `gwcli setup`, or set `gwsBinary` in config   |
| `preflight` exits `63`           | `gws` missing/outdated                       | `gwcli setup`                                 |
| `preflight` exits `64`           | No profiles configured                       | `gwcli profiles add <name> --client <path>`   |
| `gwcli: command not found`       | `gwcli` not installed globally               | `npm install -g github:dewdad/multi-gws-cli` |
| Auth errors during API call      | Profile token expired/revoked                | `gwcli profiles auth <name>`                  |
| `keep …` → `403 PERMISSION_DENIED` | Personal `@gmail.com` (Keep API is Workspace-only) | Expected on consumer accounts. See [`skill/references/keep.md`](skill/references/keep.md#consumer-keep-alternatives-personal-gmailcom) for unofficial community alternatives |

For the full exit-code table (including `gws`'s 1/2 runtime codes), see [`skill/references/troubleshooting.md`](skill/references/troubleshooting.md).

## Development

```bash
git clone https://github.com/dewdad/multi-gws-cli.git
cd multi-gws-cli
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm link            # symlink dist/index.js as `gwcli` for local testing
```

## License

MIT
