# src — mgws TypeScript source

## Purpose

TypeScript source for `mgws`, the multi-profile orchestration layer over the external `gws` CLI. `index.ts` is the binary entrypoint (`dist/index.js`). mgws never calls Google APIs directly — it resolves a profile and spawns `gws` with that profile's credentials.

## Ownership

- All `src/**/*.ts`, the build/test/lint toolchain contract, and the type-safety contract.
- Directly owned single-purpose modules (no child docs — too small to warrant a boundary):
  - `index.ts` — Commander setup, arg parsing, native-vs-passthrough routing.
  - `types/index.ts` — shared types + `MgwsError`.
  - `lib/output.ts` — table/JSON/yaml/csv formatter for native command output.
  - `compat/translations.ts` — v1→gws syntax translation (deprecated shim; slated for removal in v3.0).
  - `version.ts` — `MGWS_VERSION` string.
- Subsystem boundaries own their own rules: see Child DOX Index.

## Local Contracts

- **ESM `.js` import extensions.** `package.json` is `"type": "module"` with `moduleResolution: node`. Every relative import MUST carry a `.js` extension even though the source is `.ts` (e.g. `import { resolveProfile } from './profiles/resolver.js'`). Extensionless relative imports break the built output.
- **Strict types, no suppression.** `tsconfig` `strict: true`; eslint flags `no-explicit-any` (warn) and `no-unused-vars` (error, `^_` ignored). Never use `as any` / `@ts-ignore` / `@ts-expect-error`.
- **Two command surfaces (routed in `index.ts`).** Names in the `NATIVE_COMMANDS` set are handled by Commander; everything else is passthrough to `gws`. When adding a native command you MUST register it both in the `NATIVE_COMMANDS` set and as a Commander `.command(...)`, or it silently falls through to gws.
- **User-facing errors** throw `MgwsError(message, code, suggestion?)`. Top-level handlers (in `index.ts` and each command action) print `message` + optional `suggestion` to stderr and `process.exit(1)`. Do not `console.log` raw errors.
- **Output boundary.** `lib/output.ts` formats native command output ONLY. gws passthrough output flows through `stdio: 'inherit'` and is never re-parsed or reformatted.
- **Version sync.** `version.ts` `MGWS_VERSION` must match `package.json` `version` and `multi-gws/SKILL.md` `metadata.version`. Bump all three together.

## Work Guidance

- Tests are colocated as `*.test.ts` (vitest). Add or update the sibling test when changing a module.
- Match existing style: section-banner comments (`// ─── X ───`), explicit named exports, `node:` prefix on Node builtins in newer modules.

## Verification

- `npm run build` (tsc → `dist/`, exit 0)
- `npm test` (vitest)
- `npm run lint` (eslint `src/`)

## Child DOX Index

- `profiles/` — profile store, config layout, resolution priority, scope vocabulary, name validation.
- `gws/` — external `gws` subprocess orchestration: binary discovery, auth login, browser launch, error translation.
- `commands/` — native mgws command implementations (profiles incl. reauth/rescope, init, agenda, doctor, migrate, preflight, setup) + the shared `onboard` core.
