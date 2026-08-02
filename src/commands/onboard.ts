import { addProfile, removeProfile, refreshProfileEmail } from '../profiles/index.js';
import { getGlobalConfig } from '../profiles/config.js';
import { DEFAULT_SERVICES, FULL_ACCESS_SENTINEL } from '../profiles/scopes.js';
import { runGwsAuthLogin } from '../gws/runner.js';
import { GwcliError } from '../types/index.js';

// ─── Scope Resolution ──────────────────────────────────────────────────────

export interface ScopeSelection {
  /** Service list forwarded to `gws auth login --services`, OR the full-access sentinel. */
  scopes: string[];
  /** True when `--full` was requested (all scopes, incl. Pub/Sub + Cloud Platform). */
  fullAccess: boolean;
}

/**
 * Resolve a scope selection from CLI-style options. `--full` wins and stores the
 * {@link FULL_ACCESS_SENTINEL}; otherwise a comma list is parsed, defaulting to
 * {@link DEFAULT_SERVICES} when no `--scopes` is given. Shared by `profiles add`
 * and `init` so both paths interpret scopes identically.
 */
export function resolveScopeList(opts: { full?: boolean; scopes?: string }): ScopeSelection {
  if (opts.full === true) {
    return { scopes: [FULL_ACCESS_SENTINEL], fullAccess: true };
  }
  const raw = opts.scopes ?? DEFAULT_SERVICES.join(',');
  const scopes = raw.split(',').map(s => s.trim()).filter(Boolean);
  return { scopes, fullAccess: false };
}

// ─── Add + Authenticate (shared onboarding core) ─────────────────────────────

export interface AddAndAuthOptions {
  clientSecretPath?: string;
  displayName?: string;
  scopes: string[];
  fullAccess: boolean;
  /** Whether to run the OAuth flow after scaffolding (false = scaffold only). */
  auth: boolean;
  incognito: boolean;
  autoOpen: boolean;
  /** Invoked after the profile dir is scaffolded but before the OAuth flow starts. */
  onCreated?: () => void;
}

export interface AddAndAuthResult {
  authenticated: boolean;
  email: string | null;
  /** True when this profile became (or already was) the configured default. */
  isDefault: boolean;
}

/**
 * Scaffold a profile and (optionally) authenticate it, rolling the profile dir
 * back on auth failure so a failed login never orphans a name that would block
 * retries. Shared by `profiles add`, `init`, and `profiles rescope`.
 *
 * On auth failure this removes the scaffolded profile and throws
 * `GwcliError('AUTH_FAILED')` — callers surface the message + suggestion.
 */
export async function addAndAuthProfile(name: string, opts: AddAndAuthOptions): Promise<AddAndAuthResult> {
  addProfile(name, {
    clientSecretPath: opts.clientSecretPath,
    displayName: opts.displayName,
    scopes: opts.scopes,
  });

  opts.onCreated?.();

  // `addProfile` auto-sets the first profile as default; read it back so callers
  // can report it without re-implementing the rule.
  const isDefault = getGlobalConfig().defaultProfile === name;

  if (!opts.auth) {
    return { authenticated: false, email: null, isDefault };
  }

  const result = await runGwsAuthLogin(name, opts.scopes, {
    incognito: opts.incognito,
    autoOpen: opts.autoOpen,
    fullAccess: opts.fullAccess,
  });

  if (result.exitCode !== 0) {
    // Auth failed AFTER scaffolding — roll back to avoid orphaning the name.
    try {
      removeProfile(name);
    } catch {
      throw new GwcliError(
        `Authentication failed for profile '${name}', and automatic rollback failed.`,
        'AUTH_FAILED',
        `Clean up manually: gwcli profiles remove ${name} --force`
      );
    }
    throw new GwcliError(
      `Authentication failed for profile '${name}' (rolled back).`,
      'AUTH_FAILED',
      `Re-run: gwcli profiles add ${name}`
    );
  }

  // Best-effort: resolve and persist the bound Google identity.
  let email: string | null = null;
  try {
    email = refreshProfileEmail(name);
  } catch {
    // Non-fatal — auth succeeded.
  }

  return { authenticated: true, email, isDefault };
}
