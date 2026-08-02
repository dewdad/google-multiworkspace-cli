/**
 * Single source of truth for the mgws version string.
 *
 * Keep this in sync with package.json `version` and multi-gws/SKILL.md `metadata.version`.
 * The build script enforces this via `npm version` (which updates package.json),
 * after which this file must be hand-bumped.
 */
export const MGWS_VERSION = '2.4.0';
