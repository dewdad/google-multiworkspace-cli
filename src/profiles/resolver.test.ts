import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_DIR = join(process.env['TEMP'] ?? '/tmp', 'mgws-resolver-test-' + Date.now());
process.env['MGWS_CONFIG_DIR'] = TEST_CONFIG_DIR;

const { resolveProfileName } = await import('./resolver.js');
const { getGlobalConfig, saveGlobalConfig } = await import('./config.js');

describe('resolveProfileName', () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    delete process.env['MGWS_PROFILE'];
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    delete process.env['MGWS_PROFILE'];
  });

  it('Priority 1 — returns flag profile; flag wins over MGWS_PROFILE env var', () => {
    process.env['MGWS_PROFILE'] = 'env-profile';
    expect(resolveProfileName('flag-profile')).toBe('flag-profile');
  });

  it('Priority 2 — returns MGWS_PROFILE env var when no flag is given', () => {
    process.env['MGWS_PROFILE'] = 'env-profile';
    expect(resolveProfileName()).toBe('env-profile');
  });

  it('Priority 3 — returns config defaultProfile when no flag or env var', () => {
    const config = getGlobalConfig();
    config.defaultProfile = 'cfg-profile';
    saveGlobalConfig(config);

    expect(resolveProfileName()).toBe('cfg-profile');
  });

  it('Priority 4 — throws MgwsError with code NO_PROFILE when nothing is configured', () => {
    // Fresh temp dir has no config.json → defaultProfile is null
    let thrownErr: unknown;
    try {
      resolveProfileName();
    } catch (err) {
      thrownErr = err;
    }
    expect(thrownErr).toBeDefined();
    expect((thrownErr as { code?: string }).code).toBe('NO_PROFILE');
  });

  it('throws MgwsError with code INVALID_PROFILE_NAME for a traversal name supplied via flag', () => {
    let thrownErr: unknown;
    try {
      resolveProfileName('../evil');
    } catch (err) {
      thrownErr = err;
    }
    expect(thrownErr).toBeDefined();
    expect((thrownErr as { code?: string }).code).toBe('INVALID_PROFILE_NAME');
  });
});
