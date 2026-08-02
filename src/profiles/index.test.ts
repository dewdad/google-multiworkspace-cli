import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_DIR = join(process.env['TEMP'] ?? '/tmp', 'mgws-addprofile-test-' + Date.now());
process.env['MGWS_CONFIG_DIR'] = TEST_CONFIG_DIR;

const { addProfile, removeProfile, renameProfile } = await import('./index.js');
const { getProfileGwsDir, getProfileMeta } = await import('./config.js');

const VALID_CLIENT = join(TEST_CONFIG_DIR, 'client_secret.json');

describe('addProfile client-secret handling', () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(VALID_CLIENT, JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } }));
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('does NOT throw and does NOT copy a file when no clientSecretPath is given', () => {
    const meta = addProfile('embedded', { scopes: ['gmail'] });

    expect(meta.clientSecretSource).toBe('embedded-default');
    expect(existsSync(join(getProfileGwsDir('embedded'), 'client_secret.json'))).toBe(false);
    // gws dir is still scaffolded so credentials can land there after auth.
    expect(existsSync(getProfileGwsDir('embedded'))).toBe(true);

    const persisted = getProfileMeta('embedded');
    expect(persisted?.clientSecretSource).toBe('embedded-default');
  });

  it('copies client_secret.json into the profile gws dir when a valid path is given', () => {
    const meta = addProfile('custom', { clientSecretPath: VALID_CLIENT, scopes: ['gmail'] });

    const copied = join(getProfileGwsDir('custom'), 'client_secret.json');
    expect(existsSync(copied)).toBe(true);
    expect(meta.clientSecretSource).toBe(VALID_CLIENT);
  });

  it('throws CLIENT_SECRET_NOT_FOUND when a path is given but the file is missing', () => {
    const missing = join(TEST_CONFIG_DIR, 'nope.json');
    expect(() => addProfile('broken', { clientSecretPath: missing, scopes: ['gmail'] })).toThrowError(
      /Client secret file not found/
    );
    try {
      addProfile('broken2', { clientSecretPath: missing, scopes: ['gmail'] });
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CLIENT_SECRET_NOT_FOUND');
    }
  });
});

describe('removeProfile — name validation', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_CONFIG_DIR, 'profiles'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('throws MgwsError for a traversal name and does not touch the filesystem', () => {
    // Given: clean profiles dir
    const profilesDir = join(TEST_CONFIG_DIR, 'profiles');

    // When: traversal name is passed
    let thrownErr: unknown;
    try {
      removeProfile('../evil');
    } catch (err) {
      thrownErr = err;
    }

    // Then: a MgwsError was thrown
    expect(thrownErr).toBeDefined();
    expect((thrownErr as { code?: string }).code).toBeDefined();

    // And: no directory escaped the profiles dir
    expect(existsSync(join(profilesDir, '..', 'evil'))).toBe(false);
    expect(existsSync(join(TEST_CONFIG_DIR, 'evil'))).toBe(false);
  });
});

describe('renameProfile — name validation', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_CONFIG_DIR, 'profiles'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('throws MgwsError for a traversal oldName and does not touch the filesystem', () => {
    // Given: clean profiles dir
    const profilesDir = join(TEST_CONFIG_DIR, 'profiles');

    // When: traversal oldName is passed
    let thrownErr: unknown;
    try {
      renameProfile('../evil', 'ok');
    } catch (err) {
      thrownErr = err;
    }

    // Then: a MgwsError was thrown
    expect(thrownErr).toBeDefined();
    expect((thrownErr as { code?: string }).code).toBeDefined();

    // And: no directory was created or mutated outside profiles dir
    expect(existsSync(join(TEST_CONFIG_DIR, 'evil'))).toBe(false);
    expect(existsSync(join(profilesDir, 'ok'))).toBe(false);
  });

  it('throws MgwsError for a traversal newName and does not touch the filesystem', () => {
    // Given: clean profiles dir
    const profilesDir = join(TEST_CONFIG_DIR, 'profiles');

    // When: traversal newName is passed
    let thrownErr: unknown;
    try {
      renameProfile('ok', '../evil');
    } catch (err) {
      thrownErr = err;
    }

    // Then: a MgwsError was thrown
    expect(thrownErr).toBeDefined();
    expect((thrownErr as { code?: string }).code).toBeDefined();

    // And: no directory escaped the profiles dir
    expect(existsSync(join(TEST_CONFIG_DIR, 'evil'))).toBe(false);
    expect(existsSync(join(profilesDir, 'ok'))).toBe(false);
  });
});
