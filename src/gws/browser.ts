import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cross-platform browser launcher with optional incognito / private-mode
 * support.
 *
 * Why incognito by default for OAuth?
 *   When `gws auth login` opens the consent URL in the user's normal browser,
 *   Google honors `prompt=select_account+consent` against whatever Google
 *   accounts are *signed into that browser*. If the wrong account is signed
 *   in (or if the OAuth consent screen is in Testing mode and that account
 *   isn't a test user), Google emits a misleading "Required parameter is
 *   missing: response_type" error against the auto-selected account.
 *
 *   Launching in a private/InPrivate/Incognito window with no Google session
 *   cookies forces the user to actively pick (or sign into) the correct
 *   account every time, sidestepping that whole class of UX failure.
 */

export interface BrowserCommand {
  command: string;
  args: string[];
}

export interface OpenInBrowserOptions {
  /**
   * Open in a private/incognito window. Defaults to false. When true and the
   * default browser cannot be detected or isn't a known incognito-capable
   * browser, prints a warning and falls through to a regular launch — the
   * user can still manually copy the URL into a private window.
   */
  incognito?: boolean;
}

/**
 * Browser family — determines whether we need to pair the incognito flag with
 * a unique `--user-data-dir` to force a fresh isolated session.
 *
 * Why this matters:
 *   On Edge/Chrome/Brave/Vivaldi, `--inprivate`/`--incognito` alone joins an
 *   *existing* private session if one is already open. Two consecutive
 *   `gwcli profiles auth` invocations with `--inprivate` would land in the
 *   same private window, where the previous account is still signed in →
 *   Google auto-completes consent against the wrong account. Pairing with
 *   `--user-data-dir=<unique-tmp>` forces an isolated browser process per
 *   launch, guaranteeing the account chooser starts blank every time.
 *
 *   Firefox-family browsers handle `--private-window` correctly without this
 *   workaround; each call opens a fresh private window with no shared state.
 */
type BrowserFamily = 'chromium' | 'firefox' | 'opera' | 'unknown';

interface BrowserSpec {
  flag: string;
  family: BrowserFamily;
}

/**
 * Map of Windows ProgId prefix → browser spec for known browsers.
 * Firefox uses suffixed ProgIds (e.g. `FirefoxURL-308046B0AF4A39CB`), hence
 * the prefix-match in {@link mapProgIdToIncognitoFlag}.
 */
const WINDOWS_PROGID_TO_SPEC: Array<[string, BrowserSpec]> = [
  ['MSEdgeHTM', { flag: '--inprivate', family: 'chromium' }],
  ['ChromeHTML', { flag: '--incognito', family: 'chromium' }],
  ['BraveHTML', { flag: '--incognito', family: 'chromium' }],
  ['VivaldiHTM', { flag: '--incognito', family: 'chromium' }],
  ['OperaStable', { flag: '--private', family: 'opera' }],
  ['FirefoxURL', { flag: '--private-window', family: 'firefox' }],
  ['LibreWolfURL', { flag: '--private-window', family: 'firefox' }],
  ['WaterfoxURL', { flag: '--private-window', family: 'firefox' }],
];

/**
 * macOS app bundles → browser spec.
 * Used with `open -na "<App>" --args <flag> <url>`.
 */
const MAC_APP_TO_SPEC: Array<[string, BrowserSpec]> = [
  ['Microsoft Edge', { flag: '--inprivate', family: 'chromium' }],
  ['Google Chrome', { flag: '--incognito', family: 'chromium' }],
  ['Brave Browser', { flag: '--incognito', family: 'chromium' }],
  ['Vivaldi', { flag: '--incognito', family: 'chromium' }],
  ['Firefox', { flag: '--private-window', family: 'firefox' }],
  ['LibreWolf', { flag: '--private-window', family: 'firefox' }],
];

/**
 * Linux executable name → browser spec. Resolved via `xdg-mime query`.
 */
const LINUX_EXE_TO_SPEC: Array<[string, BrowserSpec]> = [
  ['microsoft-edge', { flag: '--inprivate', family: 'chromium' }],
  ['microsoft-edge-stable', { flag: '--inprivate', family: 'chromium' }],
  ['google-chrome', { flag: '--incognito', family: 'chromium' }],
  ['google-chrome-stable', { flag: '--incognito', family: 'chromium' }],
  ['chromium', { flag: '--incognito', family: 'chromium' }],
  ['chromium-browser', { flag: '--incognito', family: 'chromium' }],
  ['brave-browser', { flag: '--incognito', family: 'chromium' }],
  ['vivaldi', { flag: '--incognito', family: 'chromium' }],
  ['firefox', { flag: '--private-window', family: 'firefox' }],
  ['librewolf', { flag: '--private-window', family: 'firefox' }],
];

/**
 * Build the per-launch isolation flags for a given browser family. For
 * Chromium-family browsers, returns `['--user-data-dir=<unique-tmp>',
 * '--no-first-run', '--no-default-browser-check']` so each invocation gets a
 * fresh isolated session and doesn't show first-run / default-browser prompts.
 *
 * Returns an empty array for browsers that don't need the workaround
 * (Firefox/LibreWolf/Waterfox handle `--private-window` correctly already).
 */
export function buildIsolationArgs(family: BrowserFamily): string[] {
  if (family !== 'chromium') return [];
  const userDataDir = mkdtempSync(join(tmpdir(), 'gwcli-oauth-'));
  return [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/**
 * Resolve the browser spec (incognito flag + family) for a Windows ProgId via
 * prefix match. Returns null for unknown browsers.
 */
export function mapProgIdToBrowserSpec(progId: string): BrowserSpec | null {
  for (const [prefix, spec] of WINDOWS_PROGID_TO_SPEC) {
    if (progId.startsWith(prefix)) return spec;
  }
  return null;
}

/**
 * Backwards-compatible thin wrapper that returns just the flag.
 * Retained because tests still cover ProgId → flag mapping directly.
 */
export function mapProgIdToIncognitoFlag(progId: string): string | null {
  return mapProgIdToBrowserSpec(progId)?.flag ?? null;
}

/**
 * Read `ProgId` from `HKCU\...\UrlAssociations\https\UserChoice` to determine
 * the user's currently configured default browser for HTTPS URLs.
 */
export function readWindowsDefaultBrowserProgId(): string | null {
  const result = spawnSync(
    'reg',
    [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
      '/v',
      'ProgId',
    ],
    { encoding: 'utf-8', timeout: 5_000 }
  );

  if (result.status !== 0 || !result.stdout) return null;
  // Output line: `    ProgId    REG_SZ    MSEdgeHTM`
  const match = result.stdout.match(/ProgId\s+REG_SZ\s+(\S+)/);
  return match?.[1] ?? null;
}

/**
 * Resolve the executable path for a Windows ProgId via
 * `HKCR\<ProgId>\shell\open\command`.
 *
 * Registry value format examples:
 *   "C:\Program Files\...\msedge.exe" --single-argument %1
 *   "C:\Program Files\Mozilla Firefox\firefox.exe" -osint -url "%1"
 *   C:\Program Files\...\chrome.exe %1                          (rare, unquoted)
 */
export function readWindowsBrowserExePath(progId: string): string | null {
  const result = spawnSync(
    'reg',
    ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve'],
    { encoding: 'utf-8', timeout: 5_000 }
  );

  if (result.status !== 0 || !result.stdout) return null;

  // Find the line containing the value.
  const valueLine = result.stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
  if (!valueLine || !valueLine[1]) return null;
  const raw = valueLine[1].trim();

  // Quoted exe path: take the first quoted run.
  const quoted = raw.match(/^"([^"]+)"/);
  if (quoted && quoted[1]) return quoted[1];

  // Unquoted: take everything up to the first " %1" / " %L" placeholder, or
  // the first whitespace if no placeholder.
  const placeholderIdx = raw.search(/\s+(%1|%L|--single-argument)/i);
  if (placeholderIdx !== -1) return raw.slice(0, placeholderIdx).trim();
  return raw.split(/\s+/)[0] ?? null;
}

/**
 * Produce an incognito-mode launch command for the user's default browser on
 * Windows. For Chromium-family browsers, pairs the incognito flag with a
 * unique `--user-data-dir` so each launch gets a fresh isolated session.
 * Returns null if detection fails or the browser isn't on the known list.
 */
export function detectWindowsIncognitoCommand(url: string): BrowserCommand | null {
  const progId = readWindowsDefaultBrowserProgId();
  if (!progId) return null;

  const spec = mapProgIdToBrowserSpec(progId);
  if (!spec) return null;

  const exe = readWindowsBrowserExePath(progId);
  if (!exe) return null;

  return {
    command: exe,
    args: [spec.flag, ...buildIsolationArgs(spec.family), url],
  };
}

/**
 * Produce an incognito-mode launch command on macOS. We don't have a
 * registry-equivalent that's reliable across versions for "default browser",
 * so we try known browsers in install-priority order via `open -na`.
 *
 * `open -na "App" --args <flag> <url>` opens the URL in App's command-line,
 * which honors the private-mode flag.
 */
export function detectMacIncognitoCommand(url: string): BrowserCommand | null {
  // We can't easily probe app existence without `osascript` or fs lookups in
  // /Applications, but `open -na` will fail cleanly if the app is missing,
  // so we try the most likely match first based on common defaults.
  const entry = MAC_APP_TO_SPEC[0];
  if (!entry) return null;
  const [app, spec] = entry;
  return {
    command: 'open',
    args: ['-na', app, '--args', spec.flag, ...buildIsolationArgs(spec.family), url],
  };
}

/**
 * Produce an incognito-mode launch command on Linux. Uses `xdg-mime query` to
 * find the .desktop file for https, parses Exec=, then maps to a known flag.
 */
export function detectLinuxIncognitoCommand(url: string): BrowserCommand | null {
  const xdgQuery = spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], {
    encoding: 'utf-8',
    timeout: 5_000,
  });
  if (xdgQuery.status !== 0 || !xdgQuery.stdout) return null;

  const desktopName = xdgQuery.stdout.trim();
  // desktopName is like 'firefox.desktop' or 'google-chrome.desktop'.
  const stem = desktopName.replace(/\.desktop$/, '');

  for (const [exe, spec] of LINUX_EXE_TO_SPEC) {
    if (stem.includes(exe)) {
      return {
        command: exe,
        args: [spec.flag, ...buildIsolationArgs(spec.family), url],
      };
    }
  }
  return null;
}

/**
 * Build a default (non-incognito) launch command for the OS shell handler.
 */
export function defaultLaunchCommand(url: string): BrowserCommand {
  switch (process.platform) {
    case 'win32':
      // `cmd /c start "" "<url>"` — empty `""` is the window-title placeholder
      // required when the actual target is a quoted string.
      return { command: 'cmd', args: ['/c', 'start', '""', url] };
    case 'darwin':
      return { command: 'open', args: [url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

/**
 * Resolve the launch command to use for a given URL + options. Always returns
 * a usable command — falls through to the OS shell handler when incognito
 * detection fails.
 *
 * @returns the resolved launch command and a boolean indicating whether it is
 *          actually incognito-mode (false on detection-failure fallback).
 */
export function resolveLaunchCommand(
  url: string,
  options: OpenInBrowserOptions
): { command: BrowserCommand; isIncognito: boolean } {
  if (!options.incognito) {
    return { command: defaultLaunchCommand(url), isIncognito: false };
  }

  let detected: BrowserCommand | null = null;
  switch (process.platform) {
    case 'win32':
      detected = detectWindowsIncognitoCommand(url);
      break;
    case 'darwin':
      detected = detectMacIncognitoCommand(url);
      break;
    default:
      detected = detectLinuxIncognitoCommand(url);
      break;
  }

  if (detected) return { command: detected, isIncognito: true };
  return { command: defaultLaunchCommand(url), isIncognito: false };
}

/**
 * Launch a URL in a browser. Best-effort — silently no-ops if the platform
 * launcher isn't available. When `incognito: true` is requested but the user's
 * default browser can't be detected or isn't a known incognito-capable
 * browser, prints a warning to stderr and falls back to a regular launch.
 */
export function openInBrowser(url: string, options: OpenInBrowserOptions = {}): void {
  const { command, isIncognito } = resolveLaunchCommand(url, options);

  if (options.incognito && !isIncognito) {
    process.stderr.write(
      'gwcli: could not detect a known incognito-capable default browser. ' +
        'Opening in default browser instead.\n' +
        'If the wrong Google account is auto-selected, copy the URL above and paste it into a private/incognito window.\n'
    );
  }

  try {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    // Swallow launcher errors — gws has already printed the URL to the terminal.
    child.on('error', () => {
      /* no-op */
    });
  } catch {
    /* no-op — platform launcher unavailable, user still has the URL */
  }
}
