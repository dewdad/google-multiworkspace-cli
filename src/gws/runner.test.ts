import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock fs (token-cache invalidation reads existsSync + calls rmSync).
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
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

const { runGws, runGwsAuthLogin, openInBrowser } = await import('./runner.js');
const { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } = await import('./default-client.js');

/**
 * Build a fake `spawn`-returned ChildProcess sufficient for runGwsAuthLogin's
 * use of stdout/stderr streams + 'close'/'error' events.
 */
function makeFakeChild(): {
  child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    unref: () => void;
  };
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
  close: (code: number) => void;
  error: (err: Error) => void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    unref: vi.fn(),
  });
  return {
    child,
    emitStdout: (d) => stdout.write(d),
    emitStderr: (d) => stderr.write(d),
    close: (code) => child.emit('close', code),
    error: (err) => child.emit('error', err),
  };
}

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
    // In inherit mode, real spawnSync returns Buffer-typed but null-valued stdout/stderr.
    // Buffer.alloc(0) is the type-safe stand-in for "no captured output" in tests.
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
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

describe('runGwsAuthLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects the OAuth URL on stdout and invokes the browser launcher exactly once', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', ['gmail', 'calendar'], { openBrowser });

    // gws prints a header line, then the URL line, then waits.
    fake.emitStdout('Open this URL in your browser to authenticate:\n\n  ');
    fake.emitStdout(
      'https://accounts.google.com/o/oauth2/auth?scope=https://www.googleapis.com/auth/gmail.modify&access_type=offline&redirect_uri=http://localhost:8638&response_type=code&client_id=abc.apps.googleusercontent.com&prompt=select_account+consent\n'
    );
    // A second URL chunk should NOT trigger the launcher again.
    fake.emitStdout('https://accounts.google.com/o/oauth2/auth?scope=other\n');

    fake.close(0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(openBrowser).toHaveBeenCalledTimes(1);
    expect(openBrowser.mock.calls[0]![0]).toBe(
      'https://accounts.google.com/o/oauth2/auth?scope=https://www.googleapis.com/auth/gmail.modify&access_type=offline&redirect_uri=http://localhost:8638&response_type=code&client_id=abc.apps.googleusercontent.com&prompt=select_account+consent'
    );
  });

  it('detects the OAuth URL when emitted on stderr (gws routes prompts there in some builds)', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', undefined, { openBrowser });

    fake.emitStderr(
      'Visit URL: https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=zzz\n'
    );
    fake.close(0);
    await promise;

    expect(openBrowser).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=zzz'
    );
  });

  it('does NOT call the browser launcher if no URL appears (gws errored before printing it)', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', ['gmail'], { openBrowser });

    fake.emitStderr('error[client_secret]: file not found\n');
    fake.close(2);
    const result = await promise;

    expect(result.exitCode).toBe(2);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('handles URL split across multiple stdout chunks', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', undefined, { openBrowser });

    fake.emitStdout('Open this URL:\n\n  https://accounts.google.com/o/oauth2/auth?');
    fake.emitStdout('client_id=xyz&response_type=code\n');
    fake.close(0);
    await promise;

    expect(openBrowser).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/auth?client_id=xyz&response_type=code'
    );
  });

  it('autoOpen=false suppresses the browser launcher even when a URL is emitted', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', ['gmail'], { openBrowser, autoOpen: false });

    fake.emitStdout(
      'Open this URL:\n\n  https://accounts.google.com/o/oauth2/auth?client_id=abc&response_type=code\n'
    );
    fake.close(0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('autoOpen=false still tees the OAuth URL to the terminal', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      const promise = runGwsAuthLogin('work', ['gmail'], {
        openBrowser: vi.fn(),
        autoOpen: false,
      });

      fake.emitStdout(
        'Open this URL:\n\n  https://accounts.google.com/o/oauth2/auth?client_id=abc&response_type=code\n'
      );
      fake.close(0);
      await promise;

      const teed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(teed).toContain(
        'https://accounts.google.com/o/oauth2/auth?client_id=abc&response_type=code'
      );
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('autoOpen omitted (default true) invokes the browser launcher once', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', ['gmail'], { openBrowser });

    fake.emitStdout(
      'Open this URL:\n\n  https://accounts.google.com/o/oauth2/auth?client_id=abc&response_type=code\n'
    );
    fake.close(0);
    await promise;

    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  it('autoOpen=false wins over an injected openBrowser combined with incognito=false', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const openBrowser = vi.fn();
    const promise = runGwsAuthLogin('work', ['gmail'], {
      openBrowser,
      autoOpen: false,
      incognito: false,
    });

    fake.emitStdout(
      'Open this URL:\n\n  https://accounts.google.com/o/oauth2/auth?client_id=abc&response_type=code\n'
    );
    fake.close(0);
    await promise;

    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('passes the correct env vars to gws (config dir, keyring backend) and the --services flag', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const promise = runGwsAuthLogin('work', ['gmail', 'drive'], { openBrowser: vi.fn() });
    fake.close(0);
    await promise;

    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[1]).toEqual(
      expect.arrayContaining(['auth', 'login', '--services', 'gmail,drive'])
    );
    expect(callArgs[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          GOOGLE_WORKSPACE_CLI_CONFIG_DIR: '/mock/config/profiles/work/gws',
          GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file',
        }),
        stdio: ['inherit', 'pipe', 'pipe'],
      })
    );
  });

  it('injects the built-in default OAuth client into the child env when the ambient env does not set it', async () => {
    const origId = process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'];
    const origSecret = process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'];
    delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'];
    delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'];
    try {
      const mockSpawn = vi.mocked(spawn);
      const fake = makeFakeChild();
      mockSpawn.mockReturnValue(fake.child as never);

      const promise = runGwsAuthLogin('work', ['gmail'], { openBrowser: vi.fn() });
      fake.close(0);
      await promise;

      const env = (mockSpawn.mock.calls[0]![2] as { env: Record<string, string> }).env;
      expect(env['GOOGLE_WORKSPACE_CLI_CLIENT_ID']).toBe(DEFAULT_OAUTH_CLIENT_ID);
      expect(env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET']).toBe(DEFAULT_OAUTH_CLIENT_SECRET);
    } finally {
      if (origId === undefined) delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'];
      else process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'] = origId;
      if (origSecret === undefined) delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'];
      else process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'] = origSecret;
    }
  });

  it('does NOT override an ambient GOOGLE_WORKSPACE_CLI_CLIENT_ID/SECRET with the default (precedence)', async () => {
    const origId = process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'];
    const origSecret = process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'];
    process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'] = 'ambient-id.apps.googleusercontent.com';
    process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'] = 'ambient-secret';
    try {
      const mockSpawn = vi.mocked(spawn);
      const fake = makeFakeChild();
      mockSpawn.mockReturnValue(fake.child as never);

      const promise = runGwsAuthLogin('work', ['gmail'], { openBrowser: vi.fn() });
      fake.close(0);
      await promise;

      const env = (mockSpawn.mock.calls[0]![2] as { env: Record<string, string> }).env;
      expect(env['GOOGLE_WORKSPACE_CLI_CLIENT_ID']).toBe('ambient-id.apps.googleusercontent.com');
      expect(env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET']).toBe('ambient-secret');
    } finally {
      if (origId === undefined) delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'];
      else process.env['GOOGLE_WORKSPACE_CLI_CLIENT_ID'] = origId;
      if (origSecret === undefined) delete process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'];
      else process.env['GOOGLE_WORKSPACE_CLI_CLIENT_SECRET'] = origSecret;
    }
  });

  it('resolves with exitCode 1 when spawn emits an error event', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const promise = runGwsAuthLogin('work', undefined, { openBrowser: vi.fn() });
    fake.error(new Error('ENOENT'));

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it('invalidates token_cache.json on successful auth (gws bug workaround)', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);
    vi.mocked(existsSync).mockReturnValue(true);

    const promise = runGwsAuthLogin('work', undefined, { openBrowser: vi.fn() });
    fake.close(0);
    await promise;

    // Must remove the stale access-token cache, otherwise subsequent gws API
    // calls return data for the previously-authenticated account until the
    // ~1h access token expires. Path uses platform-native separators
    // (path.join on win32 produces backslashes), so match the basename
    // robustly with a regex instead of asserting an exact string.
    expect(vi.mocked(rmSync)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(rmSync).mock.calls[0]!;
    expect(String(call[0])).toMatch(/[\\/]token_cache\.json$/);
    expect(String(call[0])).toContain('work');
    expect(call[1]).toEqual(expect.objectContaining({ force: true }));
  });

  it('does NOT invalidate token cache when auth fails (no fresh credentials to fall through to)', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    const promise = runGwsAuthLogin('work', undefined, { openBrowser: vi.fn() });
    fake.close(2);
    await promise;

    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it('skips token cache deletion when file does not exist (idempotent)', async () => {
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);
    vi.mocked(existsSync).mockReturnValue(false);

    const promise = runGwsAuthLogin('work', undefined, { openBrowser: vi.fn() });
    fake.close(0);
    await promise;

    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });
});

describe('openInBrowser', () => {
  const origPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p });
  }

  it('uses cmd /c start on win32', () => {
    setPlatform('win32');
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    openInBrowser('https://example.com/auth');

    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[0]).toBe('cmd');
    expect(callArgs[1]).toEqual(['/c', 'start', '""', 'https://example.com/auth']);
    expect(fake.child.unref).toHaveBeenCalled();
  });

  it('uses open on darwin', () => {
    setPlatform('darwin');
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    openInBrowser('https://example.com/auth');

    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[0]).toBe('open');
    expect(callArgs[1]).toEqual(['https://example.com/auth']);
  });

  it('uses xdg-open on linux', () => {
    setPlatform('linux');
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    openInBrowser('https://example.com/auth');

    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[0]).toBe('xdg-open');
    expect(callArgs[1]).toEqual(['https://example.com/auth']);
  });

  it('swallows launcher errors silently', () => {
    setPlatform('linux');
    const mockSpawn = vi.mocked(spawn);
    const fake = makeFakeChild();
    mockSpawn.mockReturnValue(fake.child as never);

    expect(() => openInBrowser('https://example.com/auth')).not.toThrow();
    // Emitting error after the call returns must not throw either.
    expect(() => fake.error(new Error('xdg-open not found'))).not.toThrow();
  });
});
