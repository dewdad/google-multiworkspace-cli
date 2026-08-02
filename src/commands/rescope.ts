import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeProfile } from '../profiles/index.js';
import { getProfileMeta, getProfileGwsDir, hasClientSecret } from '../profiles/config.js';
import { FULL_ACCESS_SENTINEL } from '../profiles/scopes.js';
import { addAndAuthProfile, type ScopeSelection } from './onboard.js';
import { findGwsBinary } from '../gws/binary.js';
import { GwcliError } from '../types/index.js';

export interface RescopeOps {
  add?: string;
  remove?: string;
  set?: string;
  full?: boolean;
}

function parseCsv(value?: string): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Compute the new scope selection from a profile's current scopes plus the
 * requested `--add`/`--remove`/`--set`/`--full` operations. Pure/testable.
 *
 * `--full` short-circuits to the full-access sentinel. Otherwise the base set
 * is `--set` (when given) or the current services (sentinel stripped), then
 * `--add` is unioned and `--remove` subtracted. Throws when no operation is
 * requested or the result would be empty.
 */
export function computeRescope(current: string[], ops: RescopeOps): ScopeSelection {
  if (ops.full === true) {
    return { scopes: [FULL_ACCESS_SENTINEL], fullAccess: true };
  }

  if (ops.set === undefined && !ops.add && !ops.remove) {
    throw new GwcliError(
      'No scope changes requested.',
      'RESCOPE_NO_OPS',
      'Use --add, --remove, --set, or --full.'
    );
  }

  const base = ops.set !== undefined
    ? parseCsv(ops.set)
    : current.filter(s => s !== FULL_ACCESS_SENTINEL);

  const result = new Set(base);
  for (const s of parseCsv(ops.add)) result.add(s);
  for (const s of parseCsv(ops.remove)) result.delete(s);

  const scopes = [...result];
  if (scopes.length === 0) {
    throw new GwcliError(
      'The resulting scope set is empty.',
      'RESCOPE_EMPTY',
      'Keep at least one service, or use --full for all scopes.'
    );
  }

  return { scopes, fullAccess: false };
}

export interface RescopeOptions extends RescopeOps {
  incognito?: boolean;
  autoOpen?: boolean;
}

/**
 * Change a profile's scopes. Since scopes are immutable on a gws credential,
 * this removes and re-creates the profile, then re-authenticates — preserving
 * the display name and any custom OAuth client across the rebuild.
 *
 * On auth failure the profile is left removed (the original tokens were already
 * discarded by the rebuild); `addAndAuthProfile` reports the remediation.
 */
export async function runRescope(name: string, options: RescopeOptions): Promise<void> {
  findGwsBinary();

  const meta = getProfileMeta(name);
  if (!meta) {
    throw new GwcliError(
      `Profile '${name}' does not exist.`,
      'PROFILE_NOT_FOUND',
      'List profiles: gwcli profiles list'
    );
  }

  const { scopes, fullAccess } = computeRescope(meta.scopes ?? [], options);

  // Preserve a custom OAuth client across the remove + re-add, since removal
  // deletes the profile's gws dir (where client_secret.json lives).
  let preservedClient: string | undefined;
  if (hasClientSecret(name)) {
    const source = join(getProfileGwsDir(name), 'client_secret.json');
    preservedClient = join(tmpdir(), `gwcli-rescope-${name}-${Date.now()}.json`);
    copyFileSync(source, preservedClient);
  }

  console.log(`Re-scoping '${name}' — this removes and re-creates the profile, then re-authenticates.`);
  console.log(fullAccess ? 'New scopes: ALL (full access)' : `New scopes: ${scopes.join(', ')}`);

  removeProfile(name);
  try {
    await addAndAuthProfile(name, {
      clientSecretPath: preservedClient,
      displayName: meta.displayName,
      scopes,
      fullAccess,
      auth: true,
      incognito: options.incognito ?? true,
      autoOpen: options.autoOpen ?? true,
      onCreated: () => console.log(`Profile '${name}' re-created. Starting authentication...`),
    });
    console.log(`Profile '${name}' re-scoped and authenticated.`);
  } finally {
    if (preservedClient && existsSync(preservedClient)) {
      try {
        rmSync(preservedClient, { force: true });
      } catch {
        // Best-effort temp cleanup.
      }
    }
  }
}
