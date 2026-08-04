/**
 * Single source of truth for the service/scope vocabulary shared across the
 * profile commands. `mgws`'s `--scopes` flag takes **service names** (not raw
 * OAuth scope URLs) and forwards them to `gws auth login --services <list>`,
 * which maps each service to its recommended OAuth scope set.
 */

/**
 * Services granted by default when `--scopes` is omitted.
 *
 * These are the mainstream Google Workspace *user-data* services. `classroom`
 * and `admin-reports` are intentionally NOT default — they are education- /
 * admin-only and pull in scopes a typical account can't consent to, which also
 * eats into the ~25-scope testing-mode limit (see the warning below). They
 * remain available via an explicit `--scopes`.
 *
 * ⚠ Testing-mode scope limit: an unverified OAuth app (consent screen in
 * "Testing") is capped at ~25 OAuth scopes by Google. Each service here maps to
 * several scopes, so this default already sits close to the ceiling. Widening
 * it further (or using `--full`) can trip the limit and fail consent —
 * especially for personal `@gmail.com` accounts. Narrow with `--scopes` or get
 * the OAuth app verified when that happens.
 */
export const DEFAULT_SERVICES = [
  'gmail',
  'calendar',
  'drive',
  'docs',
  'sheets',
  'slides',
  'tasks',
  'keep',
  'people',
  'chat',
  'meet',
  'forms',
] as const;

/**
 * Additional services `gws` supports that are available via `--scopes` but are
 * NOT part of the default grant (niche / privileged: education + admin/audit).
 * Listed so the skill and `--help` can advertise them without defaulting them.
 */
export const OPTIONAL_SERVICES = ['classroom', 'admin-reports'] as const;

/**
 * Every service name `--scopes` accepts (default + optional). Purely for
 * documentation / validation surfaces; order is default-first.
 */
export const ALL_SERVICES = [...DEFAULT_SERVICES, ...OPTIONAL_SERVICES] as const;

/**
 * Sentinel stored in a profile's `scopes` list to record that the profile was
 * authorized with `gws auth login --full` (ALL scopes, incl. Pub/Sub +
 * Cloud Platform). It is deliberately not a valid `gws` service name so it can
 * never collide with a real `--scopes` value. `profiles auth` reads it back to
 * re-request full access on re-authentication.
 */
export const FULL_ACCESS_SENTINEL = '*full*';

/**
 * True when a stored/parsed scope list represents full access (the `--full`
 * sentinel) rather than an explicit service list.
 */
export function isFullAccess(scopes: readonly string[] | undefined): boolean {
  return !!scopes && scopes.includes(FULL_ACCESS_SENTINEL);
}

/**
 * Google's approximate OAuth-scope ceiling for an **unverified** (consent screen
 * in "Testing") app. Consent beyond this fails, so mgws uses it to decide when
 * the built-in testing-mode client can't grant a requested scope set.
 */
export const SCOPE_CAP = 25;

/**
 * Heuristic: will this scope selection exceed the ~25-scope testing-mode cap?
 *
 * mgws only knows *service names*, not the raw OAuth scopes `gws` expands them
 * into, so this is deliberately approximate (the user picked a heuristic over a
 * fragile per-service scope-count table):
 *
 * - `--full` requests EVERY scope → always over the cap.
 * - `classroom`/`admin-reports` (the {@link OPTIONAL_SERVICES}) pull in
 *   privileged scope bundles that tip the already-near-ceiling default set over.
 * - Each service maps to ~2 scopes and the 12-service {@link DEFAULT_SERVICES}
 *   set already sits just under the cap, so any set *larger* than the default
 *   will overflow it.
 *
 * Used by the onboarding gate to preemptively route over-cap requests to a
 * cap-exempt (Internal Workspace / verified) OAuth client before the doomed
 * consent attempt.
 */
export function willExceedScopeCap(
  scopes: readonly string[] | undefined,
  fullAccess: boolean
): boolean {
  if (fullAccess) return true;
  if (!scopes) return false;
  const services = scopes.filter(s => s !== FULL_ACCESS_SENTINEL);
  if (services.some(s => (OPTIONAL_SERVICES as readonly string[]).includes(s))) return true;
  return services.length > DEFAULT_SERVICES.length;
}
