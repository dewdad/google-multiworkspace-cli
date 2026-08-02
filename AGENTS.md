# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Project: multi-gws (`mgws`)

Multi-profile orchestration layer over the official `gws` CLI (`@googleworkspace/cli`). Adds named, credential-isolated profiles (AWS-CLI style) and AI-agent-friendly defaults. **`mgws` is a wrapper, not a reimplementation** — it never calls Google APIs directly; it resolves a profile and spawns `gws` with that profile's config dir. All service surface (Gmail/Calendar/Drive/Docs/Sheets/Keep/Tasks/…) comes from `gws`.

- **Runtime:** Node.js ≥18, TypeScript ESM. Binary entrypoint `dist/index.js` (built from `src/index.ts`).
- **External dependency:** `gws` is a global CLI binary, not an npm dependency. `mgws setup` installs it; `mgws doctor`/`preflight` verify it.
- **Two command surfaces:** native commands (handled by mgws) vs. passthrough (forwarded to gws). See `src/AGENTS.md`.
- **Ships an AI skill** at `multi-gws/` (bundled in the npm package) for agent consumption.

### Project-wide rules

- ESM `.js` import extensions on all relative imports (see `src/AGENTS.md`). Strict types, no `any`/`@ts-ignore` suppression.
- `MGWS_VERSION` (`src/version.ts`) ⇔ `package.json` `version` ⇔ `multi-gws/SKILL.md` `metadata.version` must stay in lockstep.
- User-facing failures throw `MgwsError(message, code, suggestion?)`.

### Verification

- `npm run build` (tsc), `npm test` (vitest), `npm run lint` (eslint `src/`).

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

- `src/AGENTS.md` — TypeScript source contract: ESM `.js` imports, strict types, native-vs-passthrough routing, build/test/lint toolchain. Directly owns `index.ts`, `types/`, `lib/`, `compat/`, `version.ts`.
  - `src/profiles/AGENTS.md` — profile store, config path layout, resolution priority, scope vocabulary, name validation.
  - `src/gws/AGENTS.md` — external `gws` subprocess orchestration: binary discovery, env injection, auth login + OAuth browser launch, token-cache invalidation, error translation.
  - `src/commands/AGENTS.md` — native mgws commands (profiles incl. reauth/rescope, init, agenda, doctor, migrate, preflight, setup) + shared `onboard` core + preflight exit-code namespace.
- `multi-gws/AGENTS.md` — bundled, self-improving AI skill teaching agents to drive `mgws`; owns `SKILL.md`, `references/`, `scripts/`, `bin/`.

Not indexed (transient/tooling): `dist/` (build output), `node_modules/`, `.github/workflows/`, `plans/`, `.omo/`, `.sisyphus/`, `.codegraph/`.