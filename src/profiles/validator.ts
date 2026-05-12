import { GwcliError } from '../types/index.js';

const PROFILE_NAME_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

const RESERVED_NAMES = new Set([
  'default',
  'all',
  'none',
  'config',
  'profiles',
  'doctor',
  'version',
  'migrate',
  'help',
]);

/**
 * Validate a profile name for safety and conventions.
 * Throws GwcliError with actionable suggestion on invalid input.
 */
export function validateProfileName(name: string): void {
  if (!name) {
    throw new GwcliError(
      'Profile name cannot be empty.',
      'INVALID_PROFILE_NAME',
      'Provide a name like: gwcli profiles add my-profile --client <path>'
    );
  }

  if (RESERVED_NAMES.has(name)) {
    throw new GwcliError(
      `'${name}' is a reserved name and cannot be used as a profile name.`,
      'RESERVED_PROFILE_NAME',
      `Choose a different name. Reserved: ${[...RESERVED_NAMES].join(', ')}`
    );
  }

  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new GwcliError(
      `Invalid profile name '${name}'.`,
      'INVALID_PROFILE_NAME',
      'Profile names must: start with a lowercase letter, contain only lowercase letters/digits/hyphens, and be 1-63 characters.'
    );
  }

  // Path traversal check (defense in depth)
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new GwcliError(
      `Profile name '${name}' contains unsafe characters.`,
      'UNSAFE_PROFILE_NAME',
      'Profile names cannot contain path separators or "..".'
    );
  }
}

/**
 * Check if a profile name is valid without throwing.
 */
export function isValidProfileName(name: string): boolean {
  try {
    validateProfileName(name);
    return true;
  } catch {
    return false;
  }
}
