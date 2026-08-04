import { addProfile, removeProfile, refreshProfileEmail } from '../profiles/index.js';
import { getGlobalConfig } from '../profiles/config.js';
import { DEFAULT_SERVICES, FULL_ACCESS_SENTINEL, SCOPE_CAP, willExceedScopeCap } from '../profiles/scopes.js';
import { runGwsAuthLogin } from '../gws/runner.js';
import { promptForCapExemptClient, type CapPromptContext } from './oauth-client-walkthrough.js';
import { MgwsError } from '../types/index.js';

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

// ─── Structured error output (--json) ────────────────────────────────────────

/**
 * Emit a failed `MgwsError` as a machine-readable JSON object on **stdout** for
 * `--json` callers (`profiles add`, `init`). The stable `error` field is the
 * `MgwsError.code` (e.g. `SCOPE_CAP_EXCEEDED`, `AUTH_FAILED`), so an agent can
 * route deterministically instead of scraping the human stderr message. Kept
 * generic so every onboarding error code is reported the same way.
 */
export function emitJsonError(err: MgwsError): void {
  process.stdout.write(
    JSON.stringify(
      {
        success: false,
        error: err.code,
        message: err.message,
        ...(err.suggestion ? { suggestion: err.suggestion } : {}),
      },
      null,
      2
    ) + '\n'
  );
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
  /**
   * Interactive prompt for a cap-exempt OAuth client. Overridable for tests.
   * Invoked only when the scope set exceeds the testing-mode cap AND no custom
   * client was supplied. Defaults to {@link promptForCapExemptClient}.
   */
  promptForCapClient?: (ctx: CapPromptContext) => Promise<string | null>;
}

// ─── Scope-cap OAuth-client gate ─────────────────────────────────────────────

/**
 * Preemptively resolve the OAuth client to authenticate with when a scope set
 * would exceed the ~25-scope testing-mode cap.
 *
 * mgws's built-in client is an unverified/testing-mode app, so consent for a
 * large scope set fails on it. When that's the case AND the caller supplied no
 * `--client`, we route through an interactive walkthrough to obtain a cap-exempt
 * (Internal Workspace / verified) client instead of attempting doomed consent.
 *
 * Pure given an injected `prompt` + `clientIdOverride` (so it's unit-testable):
 * - returns the caller's `clientSecretPath` unchanged when the gate doesn't apply
 *   (auth off, a custom client already given, an `MGWS_CLIENT_ID` override is set,
 *   or the request is within the cap);
 * - otherwise prompts and returns the chosen path, or throws `SCOPE_CAP_EXCEEDED`
 *   when the prompt is cancelled / unavailable (non-TTY).
 */
export async function resolveClientForScopeCap(
  name: string,
  opts: Pick<AddAndAuthOptions, 'auth' | 'clientSecretPath' | 'scopes' | 'fullAccess'>,
  prompt: (ctx: CapPromptContext) => Promise<string | null>,
  clientIdOverride: string | undefined = process.env['MGWS_CLIENT_ID']
): Promise<string | undefined> {
  if (!opts.auth) return opts.clientSecretPath;
  if (opts.clientSecretPath !== undefined) return opts.clientSecretPath;
  // An MGWS_CLIENT_ID override means the operator deliberately swapped the
  // built-in client (possibly an Internal/verified one) — trust it, don't gate.
  if (clientIdOverride) return opts.clientSecretPath;
  if (!willExceedScopeCap(opts.scopes, opts.fullAccess)) return opts.clientSecretPath;

  const chosen = await prompt({
    profileName: name,
    scopes: opts.scopes,
    fullAccess: opts.fullAccess,
  });
  if (chosen === null) {
    throw new MgwsError(
      `Profile '${name}' requests more OAuth scopes than mgws's built-in client can grant ` +
        `(Google caps unverified/testing-mode apps at ~${SCOPE_CAP} scopes).`,
      'SCOPE_CAP_EXCEEDED',
      `Use a cap-exempt OAuth client (Internal Workspace or verified app):\n` +
        `  mgws profiles add ${name} --client <path>\n` +
        `or narrow the request with --scopes. See multi-gws/references/oauth-bootstrap.md.`
    );
  }
  return chosen;
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
 * `MgwsError('AUTH_FAILED')` — callers surface the message + suggestion.
 */
export async function addAndAuthProfile(name: string, opts: AddAndAuthOptions): Promise<AddAndAuthResult> {
  // Preemptive scope-cap gate: if authing on the built-in (testing-mode) client
  // with a scope set that would exceed the ~25-scope cap, guide the user to a
  // cap-exempt (Internal Workspace / verified) client before scaffolding.
  const clientSecretPath = await resolveClientForScopeCap(
    name,
    opts,
    opts.promptForCapClient ?? promptForCapExemptClient
  );

  addProfile(name, {
    clientSecretPath,
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
      throw new MgwsError(
        `Authentication failed for profile '${name}', and automatic rollback failed.`,
        'AUTH_FAILED',
        `Clean up manually: mgws profiles remove ${name} --force`
      );
    }
    throw new MgwsError(
      `Authentication failed for profile '${name}' (rolled back).`,
      'AUTH_FAILED',
      `Re-run: mgws profiles add ${name}`
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
