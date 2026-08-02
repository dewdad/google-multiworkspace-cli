# multi-gws (`mgws`)

Multi-profile orchestration layer over the official **[`gws`](https://github.com/googleworkspace/cli)** CLI. Adds named profiles (like AWS CLI), per-profile credential isolation, and AI-agent-friendly defaults to Google Workspace's command-line tooling.

> **`mgws` is a wrapper, not a reimplementation.** It does not call Google APIs directly — it spawns `gws` with the right credentials for the active profile. All Gmail / Calendar / Drive / Docs / Sheets / Keep / Tasks command surface comes from `gws` itself.

## Why this exists

The official `gws` CLI is excellent but ships with a single global credential store. If you have personal + work + client Google accounts, you have to manually swap config dirs every time. `mgws` solves that:

- **Named profiles** — `mgws --profile work …` / `MGWS_PROFILE=work`, with a configurable default
- **Per-profile config isolation** — each profile gets its own `gws` config dir, so tokens never collide
- **AI-agent shipped as a skill** — bundled `multi-gws/` folder ships a [skillshare](https://github.com/runkids/skillshare)-installable skill so Claude Code / OpenCode / Cursor can drive Google Workspace via the CLI (more context-efficient than MCP)
- **Native shortcuts** — high-traffic agent flows like `mgws agenda` get first-class commands; everything else is a transparent passthrough to `gws`

## Dependencies

| Dependency        | Required at | Purpose                                         | How to get it          |
| ----------------- | ----------- | ----------------------------------------------- | ---------------------- |
| **Node.js ≥18**   | install     | runs the `mgws` binary                         | https://nodejs.org/    |
| **`gws`** (`@googleworkspace/cli`) | runtime | does all real Google API work | `mgws setup` (auto-installs globally), or `npm install -g @googleworkspace/cli` manually |
| Google OAuth client secret JSON | first profile add | per-Google-account auth | Google Cloud Console (see [Setup](#setup)) |

`gws` is **not** declared as an npm dependency, because it's a global CLI binary, not a library. `mgws setup` installs it for you, and `mgws doctor` / `mgws preflight` verify it's on PATH. You can override the binary path in `<config-root>/config.json` → `gwsBinary` if you have a non-standard install.

## Installation

```bash
# 1. Install mgws (from GitHub — requires git on PATH; npm runs `tsc` automatically via the `prepare` script)
npm install -g github:dewdad/multi-gws

# 2. One-step onboarding: install gws, create your first profile, authenticate, set as default.
#    Uses mgws's built-in OAuth client — no --client needed.
mgws init personal

# 3. Verify
mgws doctor
```

Prefer to do it in stages? `mgws setup` installs `gws` + creates config dirs (idempotent), then `mgws profiles add <name>` adds an account. `mgws init` just chains the two with the setup pre-check baked in.

> **Not on the npm registry yet.** `mgws` is installed directly from this GitHub repo. npm will clone, run `prepare` (`tsc`) to build `dist/`, then symlink the `mgws` bin globally. Standard `npm update -g` re-pulls the default branch.

`mgws setup` runs `npm install -g @googleworkspace/cli` for you and verifies the version meets the minimum (`0.20.0`). Re-run any time to repair an install. Add `--gws-version <ver>` to pin a specific `gws` version.

## Setup

### 1. Create a Google Cloud OAuth client (per Google account)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. **APIs & Services → Library** — enable each API you need (Gmail, Calendar, Drive, Docs, Sheets, Keep, Tasks)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **Desktop app**
6. Download the JSON

You can reuse one OAuth client across multiple `mgws` profiles, or create one per account — both work.

### 2. Add a profile

The built-in OAuth client means `--client` is **optional** — omit it to use mgws's bundled Desktop client:

```bash
mgws init personal                                   # one step: create + authenticate + set default
mgws profiles add personal                           # same, if gws is already installed
mgws profiles add personal --client ~/Downloads/client_secret_*.json   # your own OAuth client
```

This opens a browser for OAuth consent. Tokens are stored under `<config-root>/profiles/personal/gws/` (isolated from any other profile and from any pre-existing global `gws` install). **The first profile is auto-set as default.**

By default all supported services are requested. To restrict scopes:

```bash
mgws profiles add work --scopes gmail,calendar,drive
```

> **Scopes are immutable on a profile.** To change the scope set, use `mgws profiles rescope <name> --add drive` (or `--remove`/`--set`/`--full`) — it removes + re-adds + re-auths in one step, preserving the display name and any custom OAuth client.

### 3. Set a default profile (optional)

The first profile is already the default. Use this only to switch the default later:

```bash
mgws profiles set-default personal
```

Profile resolution order: `--profile <name>` flag → `MGWS_PROFILE` env var → configured default → error.

## Usage

`mgws` has two command surfaces:

### A) Native commands (handled by `mgws` itself)

| Command                    | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `mgws init [name]`        | One-step onboarding: ensure `gws` + create profile + authenticate + auto-default |
| `mgws profiles <action>`  | `list`, `add`, `remove`, `rename`, `set-default`, `auth`, `status`, `reauth`, `rescope` |
| `mgws agenda [--days N]`  | Profile-aware "what's on my calendar" shortcut                                  |
| `mgws setup`              | Install `gws` + create config dirs                                              |
| `mgws preflight`          | Fast (<500ms) dependency check for agents (silent on success)                   |
| `mgws doctor`             | Detailed system health report                                                   |
| `mgws migrate`            | Migrate v1 profiles to the current layout                                       |
| `mgws version-info`       | Show `mgws` and `gws` versions                                                 |

`mgws profiles reauth [--stale-only]` re-authenticates every profile (or only expired ones) serially. `mgws profiles rescope <name> --add|--remove|--set|--full` changes a profile's scopes in one step (scopes are otherwise immutable).

### B) Passthrough to `gws`

Anything that isn't a native command is forwarded to `gws` with the active profile's credentials. The argument shape is `gws`'s — see [`gws` docs](https://github.com/googleworkspace/cli) for the full surface, or run `mgws <service> --help`.

```bash
# Gmail
mgws gmail users messages list --params '{"userId":"me","maxResults":20}'
mgws gmail users messages get  --params '{"userId":"me","id":"<msg-id>"}'

# Calendar (or use the native shortcut: mgws agenda --days 7)
mgws calendar events list --params '{"calendarId":"primary","timeMin":"<ISO>","timeMax":"<ISO>"}'
mgws calendar events insert --params '{"calendarId":"primary"}' --body '<event-json>'

# Drive
mgws drive files list --params '{"pageSize":20}'
mgws drive files export --params '{"fileId":"<id>","mimeType":"application/pdf"}'

# Keep, Tasks, Docs, Sheets — same router pattern, see gws docs
mgws keep notes list --params '{"pageSize":25}'
mgws tasks tasks list --params '{"tasklist":"@default"}'
```

> **Heads-up on Keep:** the Google Keep API is Workspace-only, so `mgws keep …` returns `403 PERMISSION_DENIED` on personal `@gmail.com` accounts — the most common case. `mgws` does not work around this; the `gws` error is the signal. For consumer Keep, see [`multi-gws/references/keep.md`](multi-gws/references/keep.md#consumer-keep-alternatives-personal-gmailcom) for unofficial community alternatives ([KeepSidian](https://github.com/lc0rp/KeepSidian) for Obsidian, [KIM](https://github.com/djsudduth/keep-it-markdown) standalone) — both live outside `mgws`'s scope and trust boundary.

### Global flags

```bash
mgws --profile work <cmd>     # one-off profile selection (alias: -p)
mgws --format json <cmd>      # force JSON output (alias: -f). gws also supports table, yaml, csv
mgws --verbose <cmd>          # log profile resolution + the full gws invocation to stderr
mgws -- <raw-gws-args>        # explicit passthrough separator if a flag clashes with mgws's
```

`--profile` / `--format` / `--verbose` are stripped before forwarding; everything else goes to `gws` verbatim.

## Configuration

Config root depends on platform:

- **Linux / macOS**: `~/.config/mgws/`
- **Windows**: `%APPDATA%\mgws\`
- **Override**: set `MGWS_CONFIG_DIR=/some/path` (useful for tests / sandboxes)

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

This repo ships an AI skill at [`multi-gws/SKILL.md`](multi-gws/SKILL.md) that teaches Claude Code, OpenCode, Cursor, etc. how to drive `mgws`. Install it via [skillshare](https://github.com/runkids/skillshare) — skillshare has no registry, so use the owner-qualified GitHub source (it scans the repo and discovers the `multi-gws` skill):

```bash
skillshare install dewdad/multi-gws          # discovery mode — picks up multi-gws/SKILL.md
skillshare install dewdad/multi-gws/multi-gws # direct path to the skill dir
skillshare sync                               # distribute to your agent targets
```

Or point your agent's skill loader at `multi-gws/SKILL.md` directly. The skill includes a mandatory `mgws preflight` step (silent on success, exit codes `60–69` on remediable issues) and full per-service references under `multi-gws/references/`.

### Pre-approving for Claude Code

```json
{
  "permissions": {
    "allow": ["Bash(mgws:*)"]
  }
}
```

### Direct shell use from any agent

```bash
mgws gmail users messages list --params '{"userId":"me"}' --format json
mgws agenda --days 7 --format json
mgws drive files list --params '{"pageSize":20}' --format json
```

`mgws profiles list` and other native commands auto-select JSON when stdout is piped (table when interactive). Pass `--format json` to force it.

## Troubleshooting

| Symptom                          | Cause                                        | Fix                                           |
| -------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `gws binary not found`           | `gws` not installed / not on PATH            | `mgws setup`, or set `gwsBinary` in config   |
| `preflight` exits `63`           | `gws` missing/outdated                       | `mgws setup`                                 |
| `preflight` exits `64`           | No profiles configured                       | `mgws init <name>`                           |
| `mgws: command not found`       | `mgws` not installed globally               | `npm install -g github:dewdad/multi-gws` |
| Auth errors during API call      | Profile token expired/revoked                | `mgws profiles auth <name>`                  |
| `keep …` → `403 PERMISSION_DENIED` | Personal `@gmail.com` (Keep API is Workspace-only) | Expected on consumer accounts. See [`multi-gws/references/keep.md`](multi-gws/references/keep.md#consumer-keep-alternatives-personal-gmailcom) for unofficial community alternatives |

For the full exit-code table (including `gws`'s 1/2 runtime codes), see [`multi-gws/references/troubleshooting.md`](multi-gws/references/troubleshooting.md).

## Development

```bash
git clone https://github.com/dewdad/multi-gws.git
cd multi-gws
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm link            # symlink dist/index.js as `mgws` for local testing
```

## License

MIT
