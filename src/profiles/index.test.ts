import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_DIR = join(process.env['TEMP'] ?? '/tmp', 'gwcli-addprofile-test-' + Date.now());
process.env['GWCLI_CONFIG_DIR'] = TEST_CONFIG_DIR;

const { addProfile } = await import('./index.js');
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
