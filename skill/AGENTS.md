# skill — AI skill bundle

## Purpose

A [skillshare](https://github.com/runkids/skillshare)-installable AI skill that teaches agents (Claude Code, OpenCode, Cursor, …) to drive `gwcli` for Google Workspace access. Shipped in the npm package (`files: ["dist/", "skill/"]`). This directory is a self-improving skill, not application code.

## Ownership

- `SKILL.md` — entrypoint: frontmatter, mandatory preflight step, command tables, error recovery.
- `references/*.md` — per-service recipes (`gmail`, `calendar`, `drive`, `keep`, `tasks`) + `oauth-bootstrap`, `profiles`, `troubleshooting`, `self-improvement`.
- `scripts/setup.mjs` — standalone cross-platform installer (Node ≥18, gws, gwcli, config dirs). Kept for compatibility; native `gwcli setup`/`preflight`/`doctor` are the preferred entry points.
- `bin/gwcli.mjs` — bundled launcher shim.

## Local Contracts

- **Self-improving** (`references/self-improvement.md`): agents may edit `SKILL.md`, `references/*.md`, and `scripts/*.mjs` in place to fix bugs/inaccuracies. Keep edits minimal and one-issue-per-change; note the change in the final response so the user can propagate it.
- **Do NOT modify without explicit user approval:** the frontmatter `name` and `description` (breaks skill discovery), the overall file architecture, or `metadata.version`.
- **Version sync.** `SKILL.md` `metadata.version` must match `package.json` `version` and `src/version.ts` `GWCLI_VERSION`. Bump all three together.
- **Mandatory preflight.** `SKILL.md` Step 0 runs `gwcli preflight` on every invocation, silent on success. The preflight/runtime exit-code tables in `SKILL.md` and `references/troubleshooting.md` must stay in sync with `src/commands/preflight.ts` (`PREFLIGHT_EXIT`, range 60–69).
- **Never delete** an existing command, reference section, or example unless it is documented as wrong in the gws/gwcli source, replaced with a working equivalent, and explained in the response.

## Verification

- `gwcli doctor` for runtime health.
- `npm test` (in the repo) when a change also touches code behavior the skill documents.
