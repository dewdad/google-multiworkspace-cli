import { spawn, spawnSync } from 'node:child_process';

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
 * Map of Windows ProgId prefix → incognito CLI flag for known browsers.
 * Firefox uses suffixed ProgIds (e.g. `FirefoxURL-308046B0AF4A39CB`), hence
 * the prefix-match in {@link mapProgIdToIncognitoFlag}.
 */
const WINDOWS_PROGID_TO_FLAG: Array<[string, string]> = [
  ['MSEdgeHTM', '--inprivate'],
  ['ChromeHTML', '--incognito'],
  ['BraveHTML', '--incognito'],
  ['VivaldiHTM', '--incognito'],
  ['OperaStable', '--private'],
  ['FirefoxURL', '--private-window'],
  ['LibreWolfURL', '--private-window'],
  ['WaterfoxURL', '--private-window'],
];

/**
 * macOS app bundles → (CLI flag for incognito).
 * Used with `open -na "<App>" --args <flag> <url>`.
 */
const MAC_APP_TO_FLAG: Array<[string, string]> = [
  ['Microsoft Edge', '--inprivate'],
  ['Google Chrome', '--incognito'],
  ['Brave Browser', '--incognito'],
  ['Vivaldi', '--incognito'],
  ['Firefox', '--private-window'],
  ['LibreWolf', '--private-window'],
];

/**
 * Linux executable name → incognito flag. Resolved via `xdg-mime query` then
 * `xdg-settings get` as a fallback.
 */
const LINUX_EXE_TO_FLAG: Array<[string, string]> = [
  ['microsoft-edge', '--inprivate'],
  ['microsoft-edge-stable', '--inprivate'],
  ['google-chrome', '--incognito'],
  ['google-chrome-stable', '--incognito'],
  ['chromium', '--incognito'],
  ['chromium-browser', '--incognito'],
  ['brave-browser', '--incognito'],
  ['vivaldi', '--incognito'],
  ['firefox', '--private-window'],
  ['librewolf', '--private-window'],
];

/**
 * Resolve the incognito flag for a Windows ProgId via prefix match.
 * Returns null for unknown browsers.
 */
export function mapProgIdToIncognitoFlag(progId: string): string | null {
  for (const [prefix, flag] of WINDOWS_PROGID_TO_FLAG) {
    if (progId.startsWith(prefix)) return flag;
  }
  return null;
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
 * Windows. Returns null if detection fails or the browser isn't on the known
 * list.
 */
export function detectWindowsIncognitoCommand(url: string): BrowserCommand | null {
  const progId = readWindowsDefaultBrowserProgId();
  if (!progId) return null;

  const flag = mapProgIdToIncognitoFlag(progId);
  if (!flag) return null;

  const exe = readWindowsBrowserExePath(progId);
  if (!exe) return null;

  return { command: exe, args: [flag, url] };
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
  const [app, flag] = MAC_APP_TO_FLAG[0]!;
  return { command: 'open', args: ['-na', app, '--args', flag, url] };
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

  for (const [exe, flag] of LINUX_EXE_TO_FLAG) {
    if (stem.includes(exe)) {
      return { command: exe, args: [flag, url] };
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
