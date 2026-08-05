# skill — AI skill bundle

## Purpose

A [skillshare](https://github.com/runkids/skillshare)-installable AI skill that teaches agents (Claude Code, OpenCode, Cursor, …) to drive `mgws` for Google Workspace access. Shipped in the npm package (`files: ["dist/", "multi-gws/"]`). This directory is a self-improving skill, not application code.

## Ownership

- `SKILL.md` — entrypoint: frontmatter, mandatory preflight step, command tables, error recovery.
- `references/*.md` — per-service recipes (`gmail`, `calendar`, `drive`, `keep`, `tasks`) + `oauth-bootstrap`, `oauth-client-automation` (CDP-driven Internal OAuth client creation), `profiles`, `troubleshooting`, `self-improvement`.
- `scripts/setup.mjs` — standalone cross-platform installer (Node ≥18, gws, mgws, config dirs). Kept for compatibility; native `mgws setup`/`preflight`/`doctor` are the preferred entry points.
- `scripts/cdp_oauth_client.mjs` — self-contained (zero-dep, raw RFC 6455 over `node:net`/`node:crypto`) CDP launcher: spawns/attaches Edge/Chrome on a dedicated automation profile, forces download behavior, and captures a Cloud Console `client_secret.json`. Also `--copy-profile "<name>"`: snapshots a real Edge/Chrome profile (resolved via `Local State` info_cache) into a throwaway dir so its authenticated sessions are reused without re-login (same machine; Chrome 136+ blocks debugging the live profile), auto-deleted on exit unless `--keep-profile`. `main()` runs only on direct invocation; helpers are exported for testing. Drives `references/oauth-client-automation.md`.
- `scripts/drive_mgws_auth.py` — optional PTY wrapper that captures the consent URL from `mgws profiles auth` and holds the callback open (Unix-only; convenience, not required).
- `bin/mgws.mjs` — bundled launcher shim.

## Local Contracts

- **Self-improving** (`references/self-improvement.md`): agents may edit `SKILL.md`, `references/*.md`, and `scripts/*.mjs` in place to fix bugs/inaccuracies. Keep edits minimal and one-issue-per-change; note the change in the final response so the user can propagate it.
- **Do NOT modify without explicit user approval:** the frontmatter `name` and `description` (breaks skill discovery), the overall file architecture, or `metadata.version`.
- **Version sync.** `SKILL.md` `metadata.version` must match `package.json` `version` and `src/version.ts` `MGWS_VERSION`. Bump all three together.
- **Mandatory preflight.** `SKILL.md` Step 0 runs `mgws preflight` on every invocation, silent on success. The preflight/runtime exit-code tables in `SKILL.md` and `references/troubleshooting.md` must stay in sync with `src/commands/preflight.ts` (`PREFLIGHT_EXIT`, range 60–69).
- **Never delete** an existing command, reference section, or example unless it is documented as wrong in the gws/mgws source, replaced with a working equivalent, and explained in the response.

## Verification

- `mgws doctor` for runtime health.
- `npm test` (in the repo) when a change also touches code behavior the skill documents.
