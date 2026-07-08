import { existsSync, mkdirSync, copyFileSync, rmSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { validateProfileName } from './validator.js';
import { fetchProfileEmail } from '../gws/runner.js';
import {
  getProfileDir,
  getProfileGwsDir,
  getGlobalConfig,
  saveGlobalConfig,
  getProfileMeta,
  saveProfileMeta,
  listProfileNames,
  profileExists,
} from './config.js';
import { GwcliError, type ProfileMeta } from '../types/index.js';

// ─── Default Scopes (service names for gws --services flag) ──────────────────

const DEFAULT_SERVICES = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'keep', 'tasks'];

// ─── Profile Add ─────────────────────────────────────────────────────────────

export interface AddProfileOptions {
  clientSecretPath?: string;
  displayName?: string;
  scopes?: string[];
  noAuth?: boolean;
}

/**
 * Create a new profile directory structure. When `clientSecretPath` is given,
 * its client_secret.json is copied into the profile's gws config dir (custom
 * OAuth client). When omitted, the profile relies on gwcli's built-in Desktop
 * OAuth client injected at auth time (see gws/default-client.ts). Does NOT run
 * auth — caller must invoke gws auth login separately.
 */
export function addProfile(name: string, options: AddProfileOptions): ProfileMeta {
  validateProfileName(name);

  if (profileExists(name)) {
    throw new GwcliError(
      `Profile '${name}' already exists.`,
      'PROFILE_EXISTS',
      `Use a different name or remove it first: gwcli profiles remove ${name}`
    );
  }

  const gwsDir = getProfileGwsDir(name);
  let clientSecretSource = 'embedded-default';

  if (options.clientSecretPath !== undefined) {
    const clientPath = resolve(options.clientSecretPath);
    if (!existsSync(clientPath)) {
      throw new GwcliError(
        `Client secret file not found: ${clientPath}`,
        'CLIENT_SECRET_NOT_FOUND',
        'Download your OAuth client JSON from the Google Cloud Console.'
      );
    }
    clientSecretSource = clientPath;
  }

  mkdirSync(gwsDir, { recursive: true });

  if (clientSecretSource !== 'embedded-default') {
    copyFileSync(clientSecretSource, join(gwsDir, 'client_secret.json'));
  }

  const meta: ProfileMeta = {
    name,
    displayName: options.displayName ?? name,
    email: null,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    scopes: options.scopes ?? DEFAULT_SERVICES,
    clientSecretSource,
    tags: [],
  };
  saveProfileMeta(name, meta);

  // If this is the first profile, set as default
  const config = getGlobalConfig();
  if (!config.defaultProfile) {
    config.defaultProfile = name;
    saveGlobalConfig(config);
  }

  return meta;
}

// ─── Profile Remove ──────────────────────────────────────────────────────────

export function removeProfile(name: string): void {
  if (!profileExists(name)) {
    throw new GwcliError(
      `Profile '${name}' does not exist.`,
      'PROFILE_NOT_FOUND',
      `Available profiles: gwcli profiles list`
    );
  }

  const profileDir = getProfileDir(name);
  rmSync(profileDir, { recursive: true, force: true });

  // Clear default if this was the default profile
  const config = getGlobalConfig();
  if (config.defaultProfile === name) {
    config.defaultProfile = null;
    saveGlobalConfig(config);
  }
}

// ─── Profile List ────────────────────────────────────────────────────────────

export interface ProfileListEntry {
  name: string;
  displayName: string;
  email: string | null;
  isDefault: boolean;
  lastUsed: string | null;
  scopes: string[];
  authenticated: boolean;
}

export interface ListProfilesOptions {
  /** If true, attempt to backfill missing emails by hitting gws (slow but accurate). */
  backfillEmail?: boolean;
}

export function listAllProfiles(options: ListProfilesOptions = {}): ProfileListEntry[] {
  const names = listProfileNames();
  const config = getGlobalConfig();

  return names.map(name => {
    const meta = getProfileMeta(name);
    const gwsDir = getProfileGwsDir(name);
    const hasCredentials = existsSync(join(gwsDir, 'credentials.enc')) ||
                           existsSync(join(gwsDir, 'credentials.json'));

    let email = meta?.email ?? null;

    // Lazy backfill: opt-in (off by default — `gwcli profiles list` shouldn't
    // make N network calls). Callers like `profiles status` request it
    // explicitly when accuracy matters.
    if (!email && hasCredentials && options.backfillEmail) {
      try {
        email = refreshProfileEmail(name);
      } catch {
        // Best-effort — ignore network/auth errors during backfill.
      }
    }

    return {
      name,
      displayName: meta?.displayName ?? name,
      email,
      isDefault: name === config.defaultProfile,
      lastUsed: meta?.lastUsed ?? null,
      scopes: (meta?.scopes ?? []).slice(),
      authenticated: hasCredentials,
    };
  });
}

// ─── Profile Rename ──────────────────────────────────────────────────────────

export function renameProfile(oldName: string, newName: string): void {
  validateProfileName(newName);

  if (!profileExists(oldName)) {
    throw new GwcliError(
      `Profile '${oldName}' does not exist.`,
      'PROFILE_NOT_FOUND'
    );
  }

  if (profileExists(newName)) {
    throw new GwcliError(
      `Profile '${newName}' already exists.`,
      'PROFILE_EXISTS',
      `Choose a different name.`
    );
  }

  const oldDir = getProfileDir(oldName);
  const newDir = getProfileDir(newName);
  renameSync(oldDir, newDir);

  // Update meta.json with new name
  const meta = getProfileMeta(newName);
  if (meta) {
    meta.name = newName;
    saveProfileMeta(newName, meta);
  }

  // Update default if it was the old name
  const config = getGlobalConfig();
  if (config.defaultProfile === oldName) {
    config.defaultProfile = newName;
    saveGlobalConfig(config);
  }
}

// ─── Set Default ─────────────────────────────────────────────────────────────

export function setDefaultProfile(name: string): void {
  if (!profileExists(name)) {
    throw new GwcliError(
      `Profile '${name}' does not exist.`,
      'PROFILE_NOT_FOUND',
      `Available profiles: gwcli profiles list`
    );
  }

  const config = getGlobalConfig();
  config.defaultProfile = name;
  saveGlobalConfig(config);
}

// ─── Update Last Used ────────────────────────────────────────────────────────

export function updateLastUsed(name: string): void {
  const meta = getProfileMeta(name);
  if (meta) {
    meta.lastUsed = new Date().toISOString();
    saveProfileMeta(name, meta);
  }
}

// ─── Refresh Email (post-auth identity backfill) ─────────────────────────────

/**
 * Resolve and persist the Google identity (email) bound to a profile.
 *
 * Called after a successful `auth login` and lazily by `profiles list` /
 * `profiles status` when the stored email is null. Best-effort — silently
 * returns null if no endpoint responds (e.g. revoked token, network down).
 *
 * If the resolved email indicates a consumer Gmail account (`@gmail.com`)
 * AND the profile has the `keep` scope, `keep` is removed from the stored
 * scope list since the Keep API is server-side gated to Workspace accounts
 * (see Issue 8 / `references/keep.md`). A warning is emitted on stderr.
 */
export function refreshProfileEmail(name: string): string | null {
  const email: string | null = fetchProfileEmail(name);
  if (!email) return null;

  const meta = getProfileMeta(name);
  if (!meta) return email;

  let dirty = false;

  if (meta.email !== email) {
    meta.email = email;
    dirty = true;
  }

  // Strip the keep scope on consumer @gmail.com accounts — the Keep API
  // returns 403 on every call for these, so leaving it in the consent /
  // stored-scope set is misleading.
  if (
    email.toLowerCase().endsWith('@gmail.com') &&
    Array.isArray(meta.scopes) &&
    meta.scopes.includes('keep')
  ) {
    meta.scopes = meta.scopes.filter(s => s !== 'keep');
    dirty = true;
    process.stderr.write(
      `⚠ Removed 'keep' scope from profile '${name}' (${email}) — the ` +
      `Google Keep API is gated to Workspace accounts and always returns ` +
      `403 on @gmail.com identities. See references/keep.md.\n`
    );
  }

  if (dirty) {
    saveProfileMeta(name, meta);
  }

  return email;
}
