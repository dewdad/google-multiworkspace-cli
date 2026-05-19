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
