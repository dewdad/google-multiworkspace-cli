import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

// Mock profiles config
vi.mock('../profiles/config.js', () => ({
  getProfileGwsDir: (name: string) => `/mock/config/profiles/${name}/gws`,
  getGlobalConfig: () => ({ gwsBinary: 'gws', version: 1, defaultProfile: null, settings: { defaultFormat: 'json', annotateProfile: false } }),
}));

// Mock profiles index
vi.mock('../profiles/index.js', () => ({
  updateLastUsed: vi.fn(),
}));

const { runGws } = await import('./runner.js');

describe('runGws', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes correct env vars in capture mode', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '{"result": "ok"}',
      stderr: '',
      pid: 1234,
      output: ['', '{"result": "ok"}', ''],
      signal: null,
    });

    const result = runGws({
      profileName: 'work',
      args: ['gmail', 'users', 'getProfile', '--params', '{"userId":"me"}'],
      capture: true,
    });

    const callArgs = mockSpawnSync.mock.calls[0]!;
    expect(callArgs[1]).toEqual(expect.arrayContaining(['gmail', 'users', 'getProfile', '--params', '{"userId":"me"}']));
    expect(callArgs[2]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        GOOGLE_WORKSPACE_CLI_CONFIG_DIR: '/mock/config/profiles/work/gws',
        GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file',
      }),
      stdio: 'pipe',
      encoding: 'utf-8',
    }));
    expect((callArgs[2] as { shell?: boolean }).shell).toBeUndefined();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"result": "ok"}');
  });

  it('uses inherit stdio in passthrough mode', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '' as any,
      stderr: '' as any,
      pid: 1234,
      output: ['', '', ''],
      signal: null,
    });

    const result = runGws({
      profileName: 'personal',
      args: ['drive', 'files', 'list'],
      capture: false,
    });

    const callArgs = mockSpawnSync.mock.calls[0]!;
    expect(callArgs[1]).toEqual(expect.arrayContaining(['drive', 'files', 'list']));
    expect(callArgs[2]).toEqual(expect.objectContaining({
      stdio: 'inherit',
    }));
    expect((callArgs[2] as { shell?: boolean }).shell).toBeUndefined();

    expect(result.exitCode).toBe(0);
  });

  it('forwards non-zero exit codes', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({
      status: 2,
      stdout: '{"error": {"code": 401}}',
      stderr: 'error[auth]: ...',
      pid: 1234,
      output: ['', '{"error": {"code": 401}}', 'error[auth]: ...'],
      signal: null,
    });

    const result = runGws({
      profileName: 'work',
      args: ['gmail', 'users', 'getProfile'],
      capture: true,
    });

    expect(result.exitCode).toBe(2);
  });

  it('respects fileKeyring=false option', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1234,
      output: ['', '', ''],
      signal: null,
    });

    runGws({
      profileName: 'work',
      args: ['auth', 'status'],
      capture: true,
      fileKeyring: false,
    });

    const callArgs = mockSpawnSync.mock.calls[0]!;
    const env = (callArgs[2] as { env: Record<string, string> }).env;
    expect(env['GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND']).toBeUndefined();
  });
});
