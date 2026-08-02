import { listAllProfiles, refreshProfileEmail } from '../profiles/index.js';
import { getProfileMeta } from '../profiles/config.js';
import { runGwsAuthLogin, runGwsAuthStatus } from '../gws/runner.js';
import { findGwsBinary } from '../gws/binary.js';
import { isFullAccess } from '../profiles/scopes.js';

export interface ReauthOptions {
  staleOnly?: boolean;
  incognito?: boolean;
  autoOpen?: boolean;
}

/**
 * Decide whether a gws `auth status` payload represents a stale token that
 * needs re-authentication. A missing payload (couldn't query) is treated as
 * stale so the profile still gets a re-auth attempt rather than being silently
 * skipped. Pure/testable — the network probe lives in {@link runReauth}.
 */
export function isTokenStale(status: Record<string, unknown> | null): boolean {
  if (!status) return true;
  return status['token_valid'] !== true;
}

/**
 * Re-authenticate profiles serially (never in parallel — each auth spawns its
 * own localhost callback port and consumes the shared browser window; the
 * file-keyring backend also races on concurrent same-profile token writes).
 *
 * `--stale-only` probes `gws auth status` per profile and skips ones whose
 * token is still valid. Each profile re-uses its stored scopes (or full-access
 * grant), so there is no interactive scope picker to hang a non-TTY agent.
 */
export async function runReauth(options: ReauthOptions = {}): Promise<void> {
  findGwsBinary();

  const authenticated = listAllProfiles().filter(p => p.authenticated);
  if (authenticated.length === 0) {
    console.log('No authenticated profiles to re-authenticate.');
    process.exit(0);
  }

  const targets = [];
  for (const profile of authenticated) {
    if (options.staleOnly) {
      const { status } = runGwsAuthStatus(profile.name);
      if (!isTokenStale(status)) continue;
    }
    targets.push(profile);
  }

  if (targets.length === 0) {
    console.log('All profiles have valid tokens. Nothing to re-authenticate.');
    process.exit(0);
  }

  let succeeded = 0;
  let failed = 0;

  for (const profile of targets) {
    console.log(`\n=== ${profile.name} ===`);
    const meta = getProfileMeta(profile.name);
    const scopes = meta?.scopes;
    const fullAccess = isFullAccess(scopes);

    if (!fullAccess && (!scopes || scopes.length === 0)) {
      console.error(
        `Skipping '${profile.name}': no stored scopes. ` +
        `Run: gwcli profiles auth ${profile.name} --scopes gmail,calendar,drive`
      );
      failed++;
      continue;
    }

    const result = await runGwsAuthLogin(profile.name, scopes, {
      incognito: options.incognito,
      autoOpen: options.autoOpen,
      fullAccess,
    });

    if (result.exitCode === 0) {
      succeeded++;
      try {
        const email = refreshProfileEmail(profile.name);
        if (email) console.log(`Identity: ${email}`);
      } catch {
        // Non-fatal — auth succeeded.
      }
    } else {
      failed++;
      console.error(`Failed to authenticate '${profile.name}' (exit ${result.exitCode}).`);
    }
  }

  console.log(`\nRe-auth complete: ${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}
