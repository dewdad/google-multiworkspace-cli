import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

const {
  mapProgIdToIncognitoFlag,
  readWindowsBrowserExePath,
  readWindowsDefaultBrowserProgId,
  detectWindowsIncognitoCommand,
  detectLinuxIncognitoCommand,
  defaultLaunchCommand,
  resolveLaunchCommand,
  openInBrowser,
} = await import('./browser.js');

function makeFakeChild(): EventEmitter & { unref: () => void } {
  return Object.assign(new EventEmitter(), { unref: vi.fn() });
}

const origPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: origPlatform });
});

describe('mapProgIdToIncognitoFlag', () => {
  it.each([
    ['MSEdgeHTM', '--inprivate'],
    ['ChromeHTML', '--incognito'],
    ['BraveHTML', '--incognito'],
    ['VivaldiHTM', '--incognito'],
    ['OperaStable', '--private'],
    ['FirefoxURL', '--private-window'],
    // Firefox's ProgId in real installs has a suffix — prefix-match must work.
    ['FirefoxURL-308046B0AF4A39CB', '--private-window'],
    ['LibreWolfURL-AABBCCDD', '--private-window'],
    ['WaterfoxURL-XYZ', '--private-window'],
  ])('maps ProgId %s -> %s', (progId, expected) => {
    expect(mapProgIdToIncognitoFlag(progId)).toBe(expected);
  });

  it('returns null for unknown ProgIds', () => {
    expect(mapProgIdToIncognitoFlag('IE.HTTP')).toBeNull();
    expect(mapProgIdToIncognitoFlag('SomeRandomBrowser')).toBeNull();
    expect(mapProgIdToIncognitoFlag('')).toBeNull();
  });
});

describe('readWindowsDefaultBrowserProgId', () => {
  it('parses ProgId from real reg query output (MSEdgeHTM)', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout:
        '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    MSEdgeHTM\r\n\r\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsDefaultBrowserProgId()).toBe('MSEdgeHTM');
  });

  it('returns null when reg exits non-zero', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'ERROR: The system was unable to find the specified registry key',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsDefaultBrowserProgId()).toBeNull();
  });

  it('returns null when output is missing the ProgId line', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'unexpected output',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsDefaultBrowserProgId()).toBeNull();
  });
});

describe('readWindowsBrowserExePath', () => {
  it('extracts quoted exe path with --single-argument suffix (Edge)', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout:
        '\r\nHKEY_CLASSES_ROOT\\MSEdgeHTM\\shell\\open\\command\r\n    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1\r\n\r\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsBrowserExePath('MSEdgeHTM')).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  });

  it('extracts quoted exe path with -osint -url "%1" (Firefox)', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout:
        '    (Default)    REG_SZ    "C:\\Program Files\\Mozilla Firefox\\firefox.exe" -osint -url "%1"\r\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsBrowserExePath('FirefoxURL-XYZ')).toBe(
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
    );
  });

  it('extracts unquoted exe path before %1 placeholder', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '    (Default)    REG_SZ    C:\\Apps\\browser\\app.exe %1\r\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsBrowserExePath('AppHTML')).toBe('C:\\Apps\\browser\\app.exe');
  });

  it('returns null when reg exits non-zero', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'error',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(readWindowsBrowserExePath('Anything')).toBeNull();
  });
});

describe('detectWindowsIncognitoCommand', () => {
  it('produces Edge --inprivate command for MSEdgeHTM', () => {
    const mockSpawnSync = vi.mocked(spawnSync);
    // First call: ProgId lookup. Second call: exe path lookup.
    mockSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: '    ProgId    REG_SZ    MSEdgeHTM\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout:
          '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });

    const cmd = detectWindowsIncognitoCommand('https://accounts.google.com/...');
    expect(cmd).toEqual({
      command: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      args: ['--inprivate', 'https://accounts.google.com/...'],
    });
  });

  it('returns null when ProgId is unknown (e.g. legacy IE)', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: '    ProgId    REG_SZ    IE.HTTP\r\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectWindowsIncognitoCommand('https://...')).toBeNull();
  });

  it('returns null when ProgId lookup fails', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'error',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectWindowsIncognitoCommand('https://...')).toBeNull();
  });

  it('returns null when exe path lookup fails', () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({
        status: 0,
        stdout: '    ProgId    REG_SZ    ChromeHTML\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });

    expect(detectWindowsIncognitoCommand('https://...')).toBeNull();
  });
});

describe('detectLinuxIncognitoCommand', () => {
  it('returns chrome --incognito for google-chrome.desktop', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: 'google-chrome.desktop\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectLinuxIncognitoCommand('https://...')).toEqual({
      command: 'google-chrome',
      args: ['--incognito', 'https://...'],
    });
  });

  it('returns firefox --private-window for firefox.desktop', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: 'firefox.desktop\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectLinuxIncognitoCommand('https://...')).toEqual({
      command: 'firefox',
      args: ['--private-window', 'https://...'],
    });
  });

  it('returns null for unknown desktop file', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: 'somerandombrowser.desktop\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectLinuxIncognitoCommand('https://...')).toBeNull();
  });

  it('returns null when xdg-mime is missing or fails', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    expect(detectLinuxIncognitoCommand('https://...')).toBeNull();
  });
});

describe('defaultLaunchCommand', () => {
  it('uses cmd /c start on win32', () => {
    setPlatform('win32');
    expect(defaultLaunchCommand('https://example.com')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', 'https://example.com'],
    });
  });

  it('uses open on darwin', () => {
    setPlatform('darwin');
    expect(defaultLaunchCommand('https://example.com')).toEqual({
      command: 'open',
      args: ['https://example.com'],
    });
  });

  it('uses xdg-open on linux', () => {
    setPlatform('linux');
    expect(defaultLaunchCommand('https://example.com')).toEqual({
      command: 'xdg-open',
      args: ['https://example.com'],
    });
  });
});

describe('resolveLaunchCommand', () => {
  it('returns default launch (no detection) when incognito is false', () => {
    setPlatform('win32');
    const { command, isIncognito } = resolveLaunchCommand('https://example.com', {
      incognito: false,
    });
    expect(isIncognito).toBe(false);
    expect(command.command).toBe('cmd');
    // spawnSync should not have been called for registry probing.
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
  });

  it('returns incognito Edge command when detection succeeds on win32', () => {
    setPlatform('win32');
    vi.mocked(spawnSync)
      .mockReturnValueOnce({
        status: 0,
        stdout: '    ProgId    REG_SZ    MSEdgeHTM\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout:
          '    (Default)    REG_SZ    "C:\\msedge.exe" --single-argument %1\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });

    const { command, isIncognito } = resolveLaunchCommand('https://example.com', {
      incognito: true,
    });
    expect(isIncognito).toBe(true);
    expect(command.command).toBe('C:\\msedge.exe');
    expect(command.args).toEqual(['--inprivate', 'https://example.com']);
  });

  it('falls back to default launch when incognito detection fails', () => {
    setPlatform('win32');
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });

    const { command, isIncognito } = resolveLaunchCommand('https://example.com', {
      incognito: true,
    });
    expect(isIncognito).toBe(false);
    expect(command.command).toBe('cmd');
  });
});

describe('openInBrowser', () => {
  it('spawns the resolved launcher and unrefs the child', () => {
    setPlatform('linux');
    vi.mocked(spawn).mockReturnValue(makeFakeChild() as never);

    openInBrowser('https://example.com');

    const callArgs = vi.mocked(spawn).mock.calls[0]!;
    expect(callArgs[0]).toBe('xdg-open');
    expect(callArgs[1]).toEqual(['https://example.com']);
    expect((callArgs[2] as { detached: boolean }).detached).toBe(true);
  });

  it('warns and falls back to default launcher when incognito detection fails', () => {
    setPlatform('linux');
    // xdg-mime returns an unknown desktop file.
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: 'unknownbrowser.desktop\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    vi.mocked(spawn).mockReturnValue(makeFakeChild() as never);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    openInBrowser('https://example.com', { incognito: true });

    // Should have spawned the fallback (xdg-open).
    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    expect(spawnCall[0]).toBe('xdg-open');
    // Should have warned the user.
    expect(stderrSpy).toHaveBeenCalled();
    const warning = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(warning).toContain('could not detect');

    stderrSpy.mockRestore();
  });

  it('does NOT warn when incognito is false (default-mode launch is intentional)', () => {
    setPlatform('linux');
    vi.mocked(spawn).mockReturnValue(makeFakeChild() as never);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    openInBrowser('https://example.com', { incognito: false });

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('uses Edge --inprivate when launching with incognito on win32 (Edge default)', () => {
    setPlatform('win32');
    vi.mocked(spawnSync)
      .mockReturnValueOnce({
        status: 0,
        stdout: '    ProgId    REG_SZ    MSEdgeHTM\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout:
          '    (Default)    REG_SZ    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --single-argument %1\r\n',
        stderr: '',
        pid: 1,
        output: [],
        signal: null,
      });
    vi.mocked(spawn).mockReturnValue(makeFakeChild() as never);

    openInBrowser('https://accounts.google.com/o/oauth2/auth?...', { incognito: true });

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    expect(spawnCall[0]).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
    expect(spawnCall[1]).toEqual([
      '--inprivate',
      'https://accounts.google.com/o/oauth2/auth?...',
    ]);
  });

  it('swallows launcher errors silently', () => {
    setPlatform('linux');
    const fake = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fake as never);

    expect(() => openInBrowser('https://example.com')).not.toThrow();
    expect(() => fake.emit('error', new Error('xdg-open not found'))).not.toThrow();
  });
});
