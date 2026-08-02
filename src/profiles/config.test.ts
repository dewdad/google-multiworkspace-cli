import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MgwsError } from '../types/index.js';

// Set MGWS_CONFIG_DIR before importing config module
const TEST_CONFIG_DIR = join(process.env['TEMP'] ?? '/tmp', 'mgws-test-' + Date.now());
process.env['MGWS_CONFIG_DIR'] = TEST_CONFIG_DIR;

const { getGlobalConfig, saveGlobalConfig, getProfileMeta, saveProfileMeta, listProfileNames, profileExists, getProfileGwsDir, ensureConfigDir } = await import('./config.js');

describe('config module', () => {
  beforeEach(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  describe('getGlobalConfig', () => {
    it('returns default config when no file exists', () => {
      const config = getGlobalConfig();
      expect(config.version).toBe(1);
      expect(config.defaultProfile).toBeNull();
      expect(config.gwsBinary).toBe('gws');
      expect(config.settings.defaultFormat).toBe('json');
    });

    it('persists and reads back config', () => {
      const config = getGlobalConfig();
      config.defaultProfile = 'work';
      saveGlobalConfig(config);

      const loaded = getGlobalConfig();
      expect(loaded.defaultProfile).toBe('work');
    });

    it('throws MgwsError on malformed config.json', () => {
      ensureConfigDir();
      writeFileSync(join(TEST_CONFIG_DIR, 'config.json'), '{ not valid json }');
      expect(() => getGlobalConfig()).toThrow(MgwsError);
    });

    it('deep-merges partial settings preserving unspecified defaults', () => {
      ensureConfigDir();
      writeFileSync(
        join(TEST_CONFIG_DIR, 'config.json'),
        JSON.stringify({
          version: 1,
          defaultProfile: null,
          gwsBinary: 'gws',
          settings: { defaultFormat: 'yaml' },
        })
      );
      const config = getGlobalConfig();
      expect(config.settings.defaultFormat).toBe('yaml');
      expect(config.settings.annotateProfile).toBe(false);
    });
  });

  describe('profile metadata', () => {
    it('returns null for non-existent profile', () => {
      expect(getProfileMeta('nonexistent')).toBeNull();
    });

    it('throws MgwsError on malformed meta.json', () => {
      ensureConfigDir();
      const profileDir = join(TEST_CONFIG_DIR, 'profiles', 'broken');
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, 'meta.json'), '{ not valid json }');
      expect(() => getProfileMeta('broken')).toThrow(MgwsError);
    });

    it('saves and loads profile metadata', () => {
      ensureConfigDir();
      const meta = {
        name: 'test',
        displayName: 'Test Profile',
        email: 'test@example.com',
        createdAt: new Date().toISOString(),
        lastUsed: null,
        scopes: ['gmail', 'drive'],
        clientSecretSource: '/path/to/secret.json',
        tags: [],
      };

      saveProfileMeta('test', meta);
      const loaded = getProfileMeta('test');

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('test');
      expect(loaded!.email).toBe('test@example.com');
      expect(loaded!.scopes).toEqual(['gmail', 'drive']);
    });
  });

  describe('listProfileNames', () => {
    it('returns empty array when no profiles exist', () => {
      ensureConfigDir();
      expect(listProfileNames()).toEqual([]);
    });

    it('lists profile directories', () => {
      ensureConfigDir();
      const profilesDir = join(TEST_CONFIG_DIR, 'profiles');
      mkdirSync(join(profilesDir, 'work'), { recursive: true });
      mkdirSync(join(profilesDir, 'personal'), { recursive: true });

      const names = listProfileNames();
      expect(names).toContain('work');
      expect(names).toContain('personal');
      expect(names).toHaveLength(2);
    });
  });

  describe('profileExists', () => {
    it('returns false for non-existent profile', () => {
      ensureConfigDir();
      expect(profileExists('ghost')).toBe(false);
    });

    it('returns true for existing profile', () => {
      ensureConfigDir();
      mkdirSync(join(TEST_CONFIG_DIR, 'profiles', 'real'), { recursive: true });
      expect(profileExists('real')).toBe(true);
    });
  });

  describe('getProfileGwsDir', () => {
    it('returns correct path', () => {
      const dir = getProfileGwsDir('work');
      expect(dir).toContain('profiles');
      expect(dir).toContain('work');
      expect(dir).toContain('gws');
    });
  });
});
