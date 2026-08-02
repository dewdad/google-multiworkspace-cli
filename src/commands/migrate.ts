import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { getProfileDir, getProfileGwsDir, getProfileMeta, saveProfileMeta, PROFILES_DIR } from '../profiles/config.js';
import { runGwsAuthLogin } from '../gws/runner.js';
import { findGwsBinary } from '../gws/binary.js';
import { MgwsError, type ProfileMeta } from '../types/index.js';
import { DEFAULT_SERVICES } from '../profiles/scopes.js';

interface MigrateOptions {
  client?: string;
  profile?: string;
  auth?: boolean;
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  findGwsBinary();

  const profilesToMigrate = options.profile
    ? [options.profile]
    : detectV1Profiles();

  if (profilesToMigrate.length === 0) {
    console.log('No v1 profiles found to migrate.');
    return;
  }

  console.log(`Found ${profilesToMigrate.length} profile(s) to migrate: ${profilesToMigrate.join(', ')}`);

  for (const name of profilesToMigrate) {
    await migrateProfile(name, options);
  }

  console.log('\nMigration complete.');
}

/**
 * Detect v1 profiles: directories in profiles/ that have credentials.json but no gws/ subdir.
 */
function detectV1Profiles(): string[] {
  if (!existsSync(PROFILES_DIR)) {
    return [];
  }

  return readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => {
      const profileDir = join(PROFILES_DIR, d.name);
      const hasOldCreds = existsSync(join(profileDir, 'credentials.json'));
      const hasNewGwsDir = existsSync(join(profileDir, 'gws'));
      return hasOldCreds && !hasNewGwsDir;
    })
    .map(d => d.name);
}

async function migrateProfile(name: string, options: MigrateOptions): Promise<void> {
  const profileDir = getProfileDir(name);
  const gwsDir = getProfileGwsDir(name);

  // Already migrated?
  if (existsSync(gwsDir)) {
    console.log(`  ✓ '${name}' — already migrated`);
    return;
  }

  console.log(`  Migrating '${name}'...`);

  const oldCreds = join(profileDir, 'credentials.json');
  if (existsSync(oldCreds)) {
    console.log(`    Found legacy credentials. Re-authentication required.`);
  }

  // Need client secret to proceed
  if (!options.client && options.auth !== false) {
    console.error(`    ✗ Migration requires --client <path> or --no-auth`);
    console.error(`      Run: mgws migrate --profile ${name} --client ~/path/to/client_secret.json`);
    return;
  }

  // Create gws directory
  mkdirSync(gwsDir, { recursive: true });

  // Copy client secret if provided
  if (options.client) {
    const clientPath = resolve(options.client);
    if (!existsSync(clientPath)) {
      throw new MgwsError(
        `Client secret file not found: ${clientPath}`,
        'CLIENT_SECRET_NOT_FOUND'
      );
    }
    copyFileSync(clientPath, join(gwsDir, 'client_secret.json'));
  }

  // Write/update meta.json
  const existingMeta = getProfileMeta(name);
  const meta: ProfileMeta = {
    name,
    displayName: existingMeta?.displayName ?? name,
    email: existingMeta?.email ?? null,
    createdAt: existingMeta?.createdAt ?? new Date().toISOString(),
    lastUsed: existingMeta?.lastUsed ?? null,
    scopes: existingMeta?.scopes ?? [...DEFAULT_SERVICES],
    clientSecretSource: options.client ? resolve(options.client) : 'unknown (migrated)',
    tags: ['migrated'],
  };
  saveProfileMeta(name, meta);

  // Run auth if not skipped
  if (options.auth !== false && options.client) {
    console.log(`    Running gws auth login...`);
    const result = await runGwsAuthLogin(name, meta.scopes);
    if (result.exitCode === 0) {
      console.log(`    ✓ '${name}' migrated and authenticated`);
    } else {
      console.error(`    ⚠ Auth failed. Run later: mgws profiles auth ${name}`);
    }
  } else {
    console.log(`    ✓ '${name}' migrated (auth skipped). Run: mgws profiles auth ${name}`);
  }
}
