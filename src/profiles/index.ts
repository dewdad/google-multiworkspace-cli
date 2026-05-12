import { existsSync, mkdirSync, copyFileSync, rmSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { validateProfileName } from './validator.js';
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
  clientSecretPath: string;
  displayName?: string;
  scopes?: string[];
  noAuth?: boolean;
}

/**
 * Create a new profile directory structure and copy client_secret.json into it.
 * Does NOT run auth — caller must invoke gws auth login separately.
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

  // Validate client secret path
  const clientPath = resolve(options.clientSecretPath);
  if (!existsSync(clientPath)) {
    throw new GwcliError(
      `Client secret file not found: ${clientPath}`,
      'CLIENT_SECRET_NOT_FOUND',
      'Download your OAuth client JSON from the Google Cloud Console.'
    );
  }

  // Create profile directories
  const gwsDir = getProfileGwsDir(name);
  mkdirSync(gwsDir, { recursive: true });

  // Copy client_secret.json into the profile's gws config dir
  copyFileSync(clientPath, join(gwsDir, 'client_secret.json'));

  // Write initial meta.json
  const meta: ProfileMeta = {
    name,
    displayName: options.displayName ?? name,
    email: null,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    scopes: options.scopes ?? DEFAULT_SERVICES,
    clientSecretSource: clientPath,
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

export function listAllProfiles(): ProfileListEntry[] {
  const names = listProfileNames();
  const config = getGlobalConfig();

  return names.map(name => {
    const meta = getProfileMeta(name);
    const gwsDir = getProfileGwsDir(name);
    const hasCredentials = existsSync(join(gwsDir, 'credentials.enc')) ||
                           existsSync(join(gwsDir, 'credentials.json'));

    return {
      name,
      displayName: meta?.displayName ?? name,
      email: meta?.email ?? null,
      isDefault: name === config.defaultProfile,
      lastUsed: meta?.lastUsed ?? null,
      scopes: meta?.scopes ?? [],
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
