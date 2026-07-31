# src/profiles — profile store, resolution & scopes

## Purpose

Owns the on-disk profile store, active-profile resolution, profile CRUD, name validation, and the service/scope vocabulary. This is gwcli's core value-add over `gws`: named, credential-isolated profiles.

## Ownership

- `config.ts` — config path layout + read/write of `config.json`, `meta.json`, profile enumeration, auth-artifact detection.
- `resolver.ts` — active-profile resolution (priority order + loading `ResolvedProfile`).
- `index.ts` — profile CRUD (add/remove/rename/set-default/list) + `refreshProfileEmail`.
- `scopes.ts` — service/scope vocabulary (`DEFAULT_SERVICES`, `OPTIONAL_SERVICES`, `--full` sentinel).
- `validator.ts` — profile-name validation + sanitization.

## Local Contracts

- **Config root resolution** (`config.ts`): `GWCLI_CONFIG_DIR` env override → win32 `%APPDATA%\gwcli` → `~/.config/gwcli`. Exposed as `CONFIG_ROOT` / `PROFILES_DIR` / `CONFIG_FILE` constants — always go through these, never hardcode paths.
- **On-disk layout:** `<config-root>/config.json` + `<config-root>/profiles/<name>/{meta.json, gws/}`. The per-profile `gws/` dir is the isolated `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` (tokens never collide across profiles).
- **Hardened JSON parsing** (`config.ts`): `getGlobalConfig()` and `getProfileMeta()` wrap `JSON.parse` in try/catch; a corrupt file throws `GwcliError` with codes `CONFIG_CORRUPTED` or `PROFILE_META_CORRUPTED` respectively (never a raw `SyntaxError`).
- **Settings deep-merge** (`config.ts`): `getGlobalConfig()` merges the `settings` sub-object with `DEFAULT_GLOBAL_CONFIG.settings` as the base, so a `config.json` that specifies only some `settings` keys retains defaults for the rest. Top-level fields are still shallow-merged.
- **Resolution priority** (`resolver.ts` `resolveProfileName`): `--profile` flag → `GWCLI_PROFILE` env → `config.defaultProfile` → throw `GwcliError('NO_PROFILE')`. `resolveProfile` additionally requires metadata + auth artifacts; `resolveProfileDir` is the lenient variant for auth-time commands.
- **Profile names** (`validator.ts`): must match `^[a-z][a-z0-9-]{0,62}$`, must not be a reserved name (`default`, `all`, `config`, command names, …), must contain no path separators or `..`. Validated on every name-bearing code path before any filesystem access: `addProfile`, `removeProfile`, `renameProfile` (both old and new name), and `resolveProfileName` (all three resolution sources — flag, env var, config default). The NO_PROFILE throw path is exempt (no name to validate).
- **Scope vocabulary is service names, not raw OAuth URLs** (`scopes.ts`). `DEFAULT_SERVICES` is the single source of truth for the default grant and is forwarded to `gws auth login --services <list>`. `--full` is stored as the `FULL_ACCESS_SENTINEL` (`*full*`) — deliberately not a valid gws service name; `isFullAccess()` reads it back on re-auth.
- **Testing-mode ~25-scope ceiling.** Google caps unverified/testing-mode OAuth apps at ~25 scopes. `DEFAULT_SERVICES` already sits near the ceiling — do not widen it casually; `classroom`/`admin-reports` stay opt-in in `OPTIONAL_SERVICES`.
- **Scopes are immutable per profile** at the UX level (change = remove + re-add). The one server-driven mutation: `refreshProfileEmail` strips the `keep` scope from consumer `@gmail.com` profiles (Keep API is Workspace-gated, always 403).

## Verification

- `scopes.test.ts`, `config.test.ts`, `validator.test.ts`, `resolver.test.ts`, `index.test.ts` (vitest).
