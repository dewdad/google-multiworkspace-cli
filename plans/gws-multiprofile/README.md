# Design: Multi-Profile Orchestration Layer over `gws`

## Status: Draft

## Summary

Replace the hand-rolled Google API clients in `gwcli` with a thin multi-account orchestration layer that delegates all API calls to the `gws` CLI (`googleworkspace/cli`). The project becomes a profile manager + credential injector that gives AI agents seamless multi-account Google Workspace access across 19+ services.

## Decision Record

### Problem

- `gwcli` currently supports Gmail, Calendar, and Drive — 3 of 19+ Workspace services.
- Adding Keep, Docs, Sheets, Tasks, Chat, Meet, Admin, Forms, Classroom, Apps Script manually is months of work and permanent maintenance.
- `gws` (26K stars, Rust binary, active daily development) already covers all services with dynamic Discovery-based command generation — but has zero multi-account support.

### Options Evaluated

| Option | Effort | Coverage | Maintenance |
|--------|--------|----------|-------------|
| A. Abandon gwcli, use gws only | Low | Full | None (upstream) |
| B. Continue building gwcli independently | Very High | Partial forever | Full burden |
| C. Hybrid: multi-profile layer over gws | Moderate | Full | Profile mgmt only |

### Decision: Option C — Hybrid

**Rationale:**
1. `gws` exposes `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` env var — per-invocation credential isolation is explicitly supported.
2. The existing repo already has the product shape and basic profile commands, but the profile storage/auth layer must be rewritten for isolated `gws` config directories.
3. Effort collapses from "reimplement every Google API" to "manage config dirs and subprocess calls."
4. Agent skills from `gws` ecosystem (40+) become available to our agents immediately.
5. New Google APIs are picked up automatically via Discovery Service — zero maintenance.

### Implementation Strategy: Augment Existing (Not New Project)

**Decision:** Implement as an in-place migration of the existing `google-workspace-cli` repo.

**Confidence:** High

**Adversarial analysis considered:**

| Concern | Resolution |
|---------|------------|
| "Half-migrated state" risk | Address with a mandatory Phase 0 validation gate and a branch/tag before deleting old code. |
| "Different product identity" | Name stays. Value prop (multi-profile GWS CLI) stays. Only backend mechanism changes. |
| "Dead code drag" | `git rm` the 7 deleted files in one commit. Gone. |
| "Stale lockfile/deps" | One `npm uninstall googleapis && npm install` — trivial. |
| "Fresh start" psychological boost | Overstated for a solo 5-month project with 6 commits. Boilerplate recreation erases momentum gain. |

**Strongest argument for augmenting:** The existing repo already has the CLI identity, command organization, tests, package wiring, and basic profile UX. The profile backend still needs a real migration from plaintext `credentials.json` to per-profile `gws/` config directories; this is not a small adapter over the current auth module.

**What "augment" means mechanically:**
1. Tag current state (`v1.0.0-pre-hybrid`)
2. Complete Phase 0 against a pinned `gws` version before implementation
3. Build new modules alongside old code (Phase 1)
4. `git rm` the replaced files only after passthrough, profile add/auth, and migration tests pass
5. Result: same repo, same URL, same CI — less direct API wrapper code

**External dependency gate:** The plan is valid only after verifying the exact installed `gws` version supports:
- `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` in release builds
- `gws auth login` or the current equivalent auth command and scope flag syntax
- JSON output flags used by gwcli
- expected config artifacts under the injected config directory
- documented or observed exit codes for missing credentials and auth failures

If any item differs, update this plan before implementation.

### Risks Accepted

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `gws` breaking changes (pre-v1.0) | Medium | Medium | Pin binary version, Phase 0 validation, opt-in live contract tests on upgrade |
| `gws` project abandoned | Very Low | High | Fork; our profile layer is decoupled |
| Windows binary issues | Low | Medium | `gws` ships Windows builds; test in CI |
| Discovery Service latency | Low | Low | `gws` caches locally after first fetch |
| `gws` output format changes | Medium | Medium | Integration tests pinning expected JSON shapes; CI catches on upgrade |

## Scope

### In Scope
- Profile CRUD (add, remove, list, set-default, rename)
- Per-profile `gws` config directory management
- Credential isolation via `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`
- Command passthrough to `gws` with profile-injected env
- Agent-oriented output formatting (JSON passthrough)
- Profile-aware `gws auth login` orchestration
- Skill file generation for LLM agents

### Out of Scope
- Reimplementing any Google API calls directly
- Building an MCP server (CLI-first approach preserved)
- Modifying `gws` source (use as-is binary)
- Multi-profile concurrent operations (sequential per invocation)

## Success Criteria

1. `gwcli --profile X <any-gws-command>` works for all 19+ services
2. Primary OAuth profile setup path is: `gwcli profiles add <name> --client <path>` followed by the verified `gws` auth flow
3. Zero gwcli code changes needed when `gws` exposes new APIs through passthrough commands
4. Agent JSON output is identical to raw `gws --format json` output in default passthrough mode
5. Existing gwcli users can migrate profile names/defaults and re-authenticate with a clear `gwcli migrate` flow

## Documents

| Document | Purpose |
|----------|---------|
| [architecture.md](./architecture.md) | System design, components, data flow |
| [profile-management.md](./profile-management.md) | Storage layout, config schema, lifecycle |
| [auth-integration.md](./auth-integration.md) | gws credential injection, token lifecycle |
| [cli-interface.md](./cli-interface.md) | Command surface, flags, agent integration |
| [migration-plan.md](./migration-plan.md) | Steps from current impl to hybrid |
