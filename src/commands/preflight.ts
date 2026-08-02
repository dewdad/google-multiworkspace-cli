import { findGwsBinary } from '../gws/binary.js';
import { listProfileNames } from '../profiles/config.js';
import { MgwsError } from '../types/index.js';

/**
 * Preflight exit codes (mgws-namespace, range 60-69).
 *
 * Distinct from runtime exit codes (1=general error, 2=auth) so agents can
 * unambiguously route to a remediation. See references/troubleshooting.md.
 */
export const PREFLIGHT_EXIT = {
  READY: 0,
  GWS_MISSING: 63,
  NO_PROFILES: 64,
} as const;

interface PreflightOptions {
  json?: boolean;
}

/**
 * Fast (<500ms) dependency verification.
 *
 * Note: mgws itself is implicitly verified because this command IS mgws.
 * Node.js version is verified by the npm engines constraint at install time.
 * So preflight only needs to check gws availability and profile presence.
 */
export async function runPreflight(options: PreflightOptions = {}): Promise<void> {
  const emit = (payload: Record<string, unknown>): void => {
    if (options.json) {
      process.stderr.write(JSON.stringify(payload) + '\n');
    }
  };

  // 1. gws binary
  try {
    findGwsBinary();
  } catch (err) {
    if (err instanceof MgwsError) {
      emit({ ok: false, error: 'gws_missing', code: err.code, fix: 'mgws setup' });
      process.exit(PREFLIGHT_EXIT.GWS_MISSING);
    }
    throw err;
  }

  // 2. At least one profile
  const profiles = listProfileNames();
  if (profiles.length === 0) {
    emit({ ok: false, error: 'no_profiles', fix: 'mgws init <name>' });
    process.exit(PREFLIGHT_EXIT.NO_PROFILES);
  }

  // 3. Ready — silent on success
  emit({ ok: true, profileCount: profiles.length });
  process.exit(PREFLIGHT_EXIT.READY);
}
