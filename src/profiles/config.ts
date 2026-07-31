import { homedir, platform } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { GwcliError, type GlobalConfig, type ProfileMeta } from '../types/index.js';

// ─── Path Resolution ─────────────────────────────────────────────────────────

function getConfigRoot(): string {
  if (process.env['GWCLI_CONFIG_DIR']) {
    return process.env['GWCLI_CONFIG_DIR'];
  }

  if (platform() === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      return join(appData, 'gwcli');
    }
  }

  return join(homedir(), '.config', 'gwcli');
}

export const CONFIG_ROOT = getConfigRoot();
export const PROFILES_DIR = join(CONFIG_ROOT, 'profiles');
export const CONFIG_FILE = join(CONFIG_ROOT, 'config.json');

// ─── Directory Helpers ───────────────────────────────────────────────────────

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_ROOT)) {
    mkdirSync(CONFIG_ROOT, { recursive: true });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

export function getProfileDir(profileName: string): string {
  return join(PROFILES_DIR, profileName);
}

export function getProfileGwsDir(profileName: string): string {
  return join(PROFILES_DIR, profileName, 'gws');
}

// ─── Global Config ───────────────────────────────────────────────────────────

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  version: 1,
  defaultProfile: null,
  gwsBinary: 'gws',
  settings: {
    defaultFormat: 'json',
    annotateProfile: false,
  },
};

export function getGlobalConfig(): GlobalConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_GLOBAL_CONFIG, null, 2));
    return { ...DEFAULT_GLOBAL_CONFIG };
  }
  let raw: ReturnType<typeof JSON.parse>;
  try {
    raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    throw new GwcliError(
      `Failed to parse config file: ${CONFIG_FILE}`,
      'CONFIG_CORRUPTED',
      `Delete or repair ${CONFIG_FILE} and re-run the command.`
    );
  }
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...raw,
    settings: {
      ...DEFAULT_GLOBAL_CONFIG.settings,
      ...(raw.settings ?? {}),
    },
  };
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Profile Metadata ────────────────────────────────────────────────────────

export function getProfileMeta(profileName: string): ProfileMeta | null {
  const metaPath = join(getProfileDir(profileName), 'meta.json');
  if (!existsSync(metaPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    throw new GwcliError(
      `Failed to parse profile metadata: ${metaPath}`,
      'PROFILE_META_CORRUPTED',
      `Delete or repair ${metaPath} and re-authenticate: gwcli profiles auth ${profileName}`
    );
  }
}

export function saveProfileMeta(profileName: string, meta: ProfileMeta): void {
  const profileDir = getProfileDir(profileName);
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  writeFileSync(join(profileDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

// ─── Profile Enumeration ─────────────────────────────────────────────────────

export function listProfileNames(): string[] {
  ensureConfigDir();
  if (!existsSync(PROFILES_DIR)) {
    return [];
  }
  return readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

export function profileExists(profileName: string): boolean {
  return existsSync(getProfileDir(profileName));
}

// ─── Auth Artifact Detection ─────────────────────────────────────────────────

/**
 * Check if a profile has usable auth artifacts.
 * Checks for any known gws credential file in the profile's gws dir.
 */
export function hasAuthArtifacts(profileName: string): boolean {
  const gwsDir = getProfileGwsDir(profileName);
  if (!existsSync(gwsDir)) {
    return false;
  }

  // Check for any known credential file (order doesn't matter here, just existence)
  const knownArtifacts = [
    'credentials.enc',
    'credentials.json',
    'token_cache.json',
  ];

  return knownArtifacts.some(f => existsSync(join(gwsDir, f)));
}

/**
 * Check if a profile has a client_secret.json copied into its gws dir.
 */
export function hasClientSecret(profileName: string): boolean {
  return existsSync(join(getProfileGwsDir(profileName), 'client_secret.json'));
}
