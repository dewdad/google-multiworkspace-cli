/**
 * Single source of truth for the gwcli version string.
 *
 * Keep this in sync with package.json `version` and skill/SKILL.md `metadata.version`.
 * The build script enforces this via `npm version` (which updates package.json),
 * after which this file must be hand-bumped.
 */
export const GWCLI_VERSION = '2.1.0';
