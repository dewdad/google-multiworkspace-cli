# Self-Improvement Protocol

This skill is designed to evolve through usage. Agents that discover bugs, doc inaccuracies, or better patterns should fix them in place.

## How to improve the skill

When you find a problem (wrong command, missing flag, broken example, unclear instruction):

1. **Edit the relevant file directly** using your file-editing tools (e.g. the `edit` or `write` tools in your harness). The skill is a regular directory of markdown + scripts — no special update mechanism is needed.
2. **Keep changes minimal and targeted.** One issue per edit. Preserve unrelated content.
3. **Verify** that your change doesn't break anything: `gwcli doctor` for runtime, `npm test` (in the project repo) for code changes.
4. **Note the change in your final response** so the user can review and propagate it (e.g. via git commit, skillshare publish, or upstream PR).

## What you may modify

- `SKILL.md` — top-level commands, summary tables, error recovery
- `references/*.md` — service-specific commands and recipes
- `scripts/*.mjs` — diagnostic scripts (preflight, doctor, setup) — kept for compatibility; native `gwcli preflight`/`setup`/`doctor` are preferred entry points

## What you must NOT modify without explicit user approval

1. The frontmatter `name` and `description` (changes break skill discovery)
2. The skill's overall architecture (adding/removing top-level files)
3. The `metadata.version` field — bump only when a coherent set of improvements is ready to ship

## Removing functionality

Never delete an existing command, reference section, or example unless:
- It's documented as wrong in the actual `gws`/`gwcli` source, AND
- You've replaced it with a working equivalent, AND
- You've explained the change in your response.

## Contributing improvements upstream

If this skill is installed via `skillshare` from a hub, edits stay local to your machine. To share improvements with others:

1. Copy your edits into the source repo (`git diff` against the upstream).
2. Open a PR or DM the maintainer.
3. The skillshare hub picks up changes on the next `skillshare sync`.

There is no automatic phone-home or feedback channel from this skill — improvements are entirely opt-in by the human user.

## Changelog

### 2.3.0
- **Operating principle added (top of SKILL.md): "the binary is the source of
  truth."** Establishes a fast-path → self-heal → live-state hierarchy: use the
  documented example first, but on any surface mismatch trust `gwcli <cmd>
  --help` / `gwcli setup` over the prose, and query the CLI
  (`profiles list/status`, `preflight`, `doctor`) for live system facts instead
  of assuming. Explicitly scopes what the docs still own and the CLI can't
  self-report: operational gotchas, the interactive OAuth flow, and decision
  policy. Motivated by the v2.2.0 root cause — a doc that asserted a stale flag
  surface silently broke agents; the binary was self-describing the whole time.

### 2.2.0
- **Flag-surface correction (gws 0.22.x).** Docs previously used `--body` and a
  `--fields` flag that **do not exist** in the shipped `gws` binary. Corrected
  across SKILL.md + all references: request body → **`--json`**; field masks →
  a **`"fields"` key inside `--params`**. Verified live against gws 0.22.5
  (`--help` + a working masked Gmail list call). Root cause was a doc bug, not
  version drift (installed == upstream 2.1.0; the gwcli wrapper is a pure
  argv passthrough and used 0 bad flags).
- **New: binary upload docs.** Documented `--upload` / `--upload-content-type`
  for Drive create and Gmail send, including the constraint that `--upload`
  only accepts a **relative path inside the current working directory**.
- **New: output-parsing note.** JSON is on stdout; the `Using keyring backend:
  file` line is on stderr — capture stdout only before parsing.
- **New: activation keeps `gws` current.** Step 0a now runs `gwcli setup`
  (installs latest gws by default; `--gws-version` to pin) on activation and on
  preflight `63`. (Corrected an earlier draft that referenced a nonexistent
  `--update` flag.)
- **New: profile organization.** Added on-disk layout + naming/`--display-name`
  conventions to `references/profiles.md`.
- **Fix: typo** — stray quote in the drive.md "Search across all files" example.
- **Keep caveat** surfaced in the command router (Workspace-only; 403 on @gmail.com).
