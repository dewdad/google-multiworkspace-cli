import { MgwsError, type ResolvedProfile } from '../types/index.js';
import { getGlobalConfig, getProfileGwsDir, getProfileMeta, profileExists, hasAuthArtifacts } from './config.js';
import { validateProfileName } from './validator.js';

/**
 * Resolve the active profile from multiple sources in priority order:
 *   1. --profile flag (explicit)
 *   2. MGWS_PROFILE env var
 *   3. config.json defaultProfile
 *   4. Error
 */
export function resolveProfile(flagProfile?: string): ResolvedProfile {
  const profileName = resolveProfileName(flagProfile);
  return loadResolvedProfile(profileName);
}

/**
 * Resolve just the profile name (without loading full metadata).
 */
export function resolveProfileName(flagProfile?: string): string {
  // Priority 1: explicit flag
  if (flagProfile) {
    validateProfileName(flagProfile);
    return flagProfile;
  }

  // Priority 2: environment variable
  const envProfile = process.env['MGWS_PROFILE'];
  if (envProfile) {
    validateProfileName(envProfile);
    return envProfile;
  }

  // Priority 3: config default
  const config = getGlobalConfig();
  if (config.defaultProfile) {
    validateProfileName(config.defaultProfile);
    return config.defaultProfile;
  }

  // Priority 4: error
  throw new MgwsError(
    'No profile specified and no default set.',
    'NO_PROFILE',
    'Specify --profile <name>, set MGWS_PROFILE env var, or run: mgws profiles set-default <name>'
  );
}

/**
 * Load a full ResolvedProfile given a validated profile name.
 */
function loadResolvedProfile(profileName: string): ResolvedProfile {
  if (!profileExists(profileName)) {
    throw new MgwsError(
      `Profile '${profileName}' does not exist.`,
      'PROFILE_NOT_FOUND',
      `Available profiles: mgws profiles list\nCreate one: mgws profiles add ${profileName} --client <path>`
    );
  }

  const meta = getProfileMeta(profileName);
  if (!meta) {
    throw new MgwsError(
      `Profile '${profileName}' is missing metadata (meta.json).`,
      'PROFILE_CORRUPTED',
      `Try re-creating: mgws profiles remove ${profileName} && mgws profiles add ${profileName} --client <path>`
    );
  }

  if (!hasAuthArtifacts(profileName)) {
    throw new MgwsError(
      `Profile '${profileName}' is not authenticated.`,
      'PROFILE_NOT_AUTHENTICATED',
      `Run: mgws profiles auth ${profileName}`
    );
  }

  return {
    name: profileName,
    gwsConfigDir: getProfileGwsDir(profileName),
    meta,
  };
}

/**
 * Resolve profile for commands that only need the config dir (e.g. passthrough).
 * Less strict — doesn't require auth artifacts (useful for auth commands).
 */
export function resolveProfileDir(flagProfile?: string): { name: string; gwsConfigDir: string } {
  const profileName = resolveProfileName(flagProfile);

  if (!profileExists(profileName)) {
    throw new MgwsError(
      `Profile '${profileName}' does not exist.`,
      'PROFILE_NOT_FOUND',
      `Create it: mgws profiles add ${profileName} --client <path>`
    );
  }

  return {
    name: profileName,
    gwsConfigDir: getProfileGwsDir(profileName),
  };
}
