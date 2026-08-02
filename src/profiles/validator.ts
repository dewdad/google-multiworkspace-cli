import { MgwsError } from '../types/index.js';

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
 * Throws MgwsError with actionable suggestion on invalid input.
 */
export function validateProfileName(name: string): void {
  if (!name) {
    throw new MgwsError(
      'Profile name cannot be empty.',
      'INVALID_PROFILE_NAME',
      'Provide a name like: mgws profiles add my-profile --client <path>'
    );
  }

  if (RESERVED_NAMES.has(name)) {
    throw new MgwsError(
      `'${name}' is a reserved name and cannot be used as a profile name.`,
      'RESERVED_PROFILE_NAME',
      `Choose a different name. Reserved: ${[...RESERVED_NAMES].join(', ')}`
    );
  }

  if (!PROFILE_NAME_REGEX.test(name)) {
    const sanitized = sanitizeProfileName(name);
    const suggestion = sanitized && sanitized !== name && PROFILE_NAME_REGEX.test(sanitized)
      ? `Try '${sanitized}' instead. Rules: start with lowercase letter, [a-z0-9-]{1,63}.`
      : 'Profile names must: start with a lowercase letter, contain only lowercase letters/digits/hyphens, and be 1-63 characters.';
    throw new MgwsError(
      `Invalid profile name '${name}'.`,
      'INVALID_PROFILE_NAME',
      suggestion
    );
  }

  // Path traversal check (defense in depth)
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new MgwsError(
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

/**
 * Best-effort sanitization to suggest a valid profile name from common
 * mistakes (uppercase, dots, underscores, leading digits/hyphens).
 *
 * Returns null when no reasonable fix can be derived.
 */
export function sanitizeProfileName(name: string): string | null {
  if (!name) return null;
  let s = name.toLowerCase();
  // Replace common separators with hyphens
  s = s.replace(/[._\s/\\]+/g, '-');
  // Strip any character outside [a-z0-9-]
  s = s.replace(/[^a-z0-9-]/g, '');
  // Collapse runs of hyphens and trim leading/trailing hyphens
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  // Must start with a lowercase letter
  if (!/^[a-z]/.test(s)) {
    s = s.replace(/^[^a-z]+/, '');
  }
  // Cap at 63 chars
  if (s.length > 63) s = s.slice(0, 63).replace(/-+$/, '');
  return s.length > 0 ? s : null;
}
