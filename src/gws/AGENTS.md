# src/gws — external `gws` subprocess orchestration

## Purpose

Owns every interaction with the external `gws` binary. gwcli does no Google API work itself — it discovers `gws`, injects the active profile's credentials via env, and spawns it. Also owns the OAuth browser-launch UX and gws error/exit-code translation.

## Ownership

- `binary.ts` — locate/verify the `gws` binary, resolve the spawn command (Windows shim handling).
- `runner.ts` — spawn gws (passthrough + captured), `auth login` flow, `auth status`, email backfill, token-cache invalidation.
- `browser.ts` — cross-platform incognito browser launcher for the OAuth consent URL.
- `errors.ts` — exit-code → message translation, gws JSON error parsing.

## Local Contracts

- **Env injection on every spawn** (`runner.ts`): set `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` to the profile's `gws/` dir, and (default) `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file` for portable credentials. Never spawn gws without a resolved profile config dir.
- **Windows spawn safety** (`binary.ts` `resolveGwsSpawnCommand`): never spawn `.cmd`/`.ps1` npm shims directly (they need a shell). Resolve to `process.execPath <run.js>` for `.js` targets and for the default global install. Non-win32 spawns the binary directly.
- **Token-cache invalidation** (`runner.ts`): on a successful `auth login` (exit 0), delete `token_cache.json`. Upstream gws bug — re-auth overwrites `credentials.enc` but leaves the decrypted access-token cache stale, so API calls return the *previous* account's data until expiry (~1h). Removal is best-effort + idempotent.
- **OAuth browser launch:** gws prints the consent URL but does not open a browser (upstream design). `runner.ts` tees gws stdout/stderr to the terminal AND sniffs `OAUTH_URL_REGEX` line-by-line, launching via `browser.ts` on first match. Incognito defaults to **true** (forces an explicit account pick, avoiding the wrong-account "response_type missing" failure). Chromium-family browsers require a unique `--user-data-dir` per launch (`buildIsolationArgs`); Firefox-family handle `--private-window` alone.
- **`--full` vs `--services` are mutually exclusive** (`runGwsAuthLogin`): `fullAccess` pushes `--full` (ALL scopes incl. Pub/Sub + Cloud Platform) and ignores `services`. `--full` exceeds the ~25-scope testing-mode limit — verified apps / Workspace accounts only.
- **Exit codes** (`errors.ts`): `0` ok, `2` auth error (→ suggest `gwcli profiles auth`), `1` general (gws already printed to stderr — stay silent). `MIN_GWS_VERSION` is `0.20.0`.

## Verification

- `runner.test.ts`, `browser.test.ts` (vitest).
