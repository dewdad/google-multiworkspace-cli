import { spawn, spawnSync } from 'node:child_process';
import { getGwsBinaryPath, resolveGwsSpawnCommand } from './binary.js';
import { getProfileGwsDir } from '../profiles/config.js';
import { updateLastUsed } from '../profiles/index.js';
import { translateGwsError } from './errors.js';
import type { GwsRunResult } from '../types/index.js';

export interface RunGwsOptions {
  /** Profile name — used to resolve the config dir */
  profileName: string;
  /** Arguments to pass to gws (the command + all flags) */
  args: string[];
  /** If true, capture stdout/stderr instead of inheriting */
  capture?: boolean;
  /** If true, set GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file for portable credentials */
  fileKeyring?: boolean;
}

/**
 * Execute gws with the profile's config directory injected.
 * By default, stdio is inherited (passthrough mode — user sees gws output directly).
 */
export function runGws(options: RunGwsOptions): GwsRunResult {
  const { profileName, args, capture = false, fileKeyring = true } = options;
  const binary = getGwsBinaryPath();
  const spawnCommand = resolveGwsSpawnCommand(binary);
  const gwsConfigDir = getProfileGwsDir(profileName);

  const env: Record<string, string | undefined> = {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: gwsConfigDir,
  };

  // Use file-based keyring backend for portable credential storage
  if (fileKeyring) {
    env['GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND'] = 'file';
  }

  if (capture) {
    const result = spawnSync(spawnCommand.command, [...spawnCommand.argsPrefix, ...args], {
      env,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    tryUpdateLastUsed(profileName);

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  // Passthrough mode — stdio inherited
  const result = spawnSync(spawnCommand.command, [...spawnCommand.argsPrefix, ...args], {
    env,
    stdio: 'inherit',
  });

  tryUpdateLastUsed(profileName);

  return { exitCode: result.status ?? 1 };
}

function tryUpdateLastUsed(profileName: string): void {
  try {
    updateLastUsed(profileName);
  } catch {
    // ignore — don't let meta update failure block commands
  }
}

/**
 * Execute gws in passthrough mode and exit with gws's exit code.
 * This is the default for all non-native commands.
 */
export function execGwsPassthrough(profileName: string, gwsArgs: string[]): never {
  const { exitCode } = runGws({ profileName, args: gwsArgs });

  if (exitCode !== 0) {
    // Translate known exit codes to helpful messages on stderr
    const errorMsg = translateGwsError(exitCode);
    if (errorMsg) {
      process.stderr.write(`\ngwcli: ${errorMsg}\n`);
    }
  }

  process.exit(exitCode);
}

/**
 * OAuth URL pattern emitted by `gws auth login`.
 *
 * gws 0.22.5 prints a line like:
 *   Open this URL in your browser to authenticate:
 *
 *     https://accounts.google.com/o/oauth2/auth?scope=...&redirect_uri=http://localhost:8638&...
 *
 * but does not actually launch a browser. We detect the URL line and launch
 * the OS default browser ourselves so users don't have to copy/paste.
 */
const OAUTH_URL_REGEX = /(https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s]+)/;

/**
 * Launch a URL in the OS default browser. Best-effort — silently no-ops if the
 * platform launcher isn't available, since gws has already printed the URL to
 * the terminal as a fallback.
 */
export function openInBrowser(url: string): void {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'win32':
      // `start` is a cmd.exe builtin, not an executable. The empty "" is the
      // window-title placeholder that `start` requires when the actual target
      // is a quoted string (the URL).
      command = 'cmd';
      args = ['/c', 'start', '""', url];
      break;
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    // Don't keep the parent process alive waiting on the launcher.
    child.unref();
    // Swallow launcher errors — the URL is still printed in the terminal.
    child.on('error', () => {
      /* no-op */
    });
  } catch {
    /* no-op — platform launcher unavailable, user still has the URL */
  }
}

export interface RunGwsAuthLoginOptions {
  /**
   * Browser launcher. Overridable for testing. Defaults to {@link openInBrowser}.
   */
  openBrowser?: (url: string) => void;
}

/**
 * Run `gws auth login` for a profile, with auto-launch of the OAuth consent URL
 * in the user's default browser.
 *
 * gws itself prints the URL but does not open a browser (upstream design — see
 * googleworkspace/cli discussion #245). We pipe gws's stdout/stderr through to
 * the terminal AND watch for the OAuth URL pattern; on first match we shell
 * out to the platform browser launcher. The localhost callback inside gws
 * keeps working unchanged.
 */
export function runGwsAuthLogin(
  profileName: string,
  services?: string[],
  options: RunGwsAuthLoginOptions = {}
): Promise<GwsRunResult> {
  const openBrowser = options.openBrowser ?? openInBrowser;

  const args = ['auth', 'login'];
  if (services && services.length > 0) {
    args.push('--services', services.join(','));
  }

  const binary = getGwsBinaryPath();
  const spawnCommand = resolveGwsSpawnCommand(binary);
  const gwsConfigDir = getProfileGwsDir(profileName);

  const env: Record<string, string | undefined> = {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: gwsConfigDir,
    GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file',
  };

  return new Promise<GwsRunResult>((resolve) => {
    const child = spawn(spawnCommand.command, [...spawnCommand.argsPrefix, ...args], {
      env,
      // stdin inherited (gws doesn't read from it for the localhost flow, but
      // keeps Ctrl-C / TTY semantics intact); stdout & stderr piped so we can
      // tee them and sniff for the OAuth URL.
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let urlOpened = false;
    let buffered = '';

    const tryFireOnLine = (line: string): boolean => {
      const match = line.match(OAUTH_URL_REGEX);
      if (!match || !match[1]) return false;
      urlOpened = true;
      try {
        openBrowser(match[1]);
      } catch {
        // Never let a launcher failure abort the auth flow.
      }
      return true;
    };

    const handleChunk = (chunk: Buffer | string, sink: NodeJS.WriteStream): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      // Pass-through to the user's terminal so the UX matches the old inherit mode.
      sink.write(text);
      if (urlOpened) return;
      buffered += text;
      // Process completed lines only — a chunk may split mid-URL, and matching
      // a non-whitespace run on a partial buffer would yield a truncated URL.
      let newlineIdx = buffered.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = buffered.slice(0, newlineIdx);
        buffered = buffered.slice(newlineIdx + 1);
        if (tryFireOnLine(line)) {
          buffered = '';
          return;
        }
        newlineIdx = buffered.indexOf('\n');
      }
      // Cap the remaining (incomplete) tail to avoid unbounded growth if the
      // URL never appears (e.g. gws errors out before printing it).
      if (buffered.length > 16_384) {
        buffered = buffered.slice(-4_096);
      }
    };

    child.stdout?.on('data', (c: Buffer) => handleChunk(c, process.stdout));
    child.stderr?.on('data', (c: Buffer) => handleChunk(c, process.stderr));

    child.once('error', (err) => {
      process.stderr.write(`gwcli: failed to spawn gws: ${err.message}\n`);
      resolve({ exitCode: 1 });
    });

    child.once('close', (code) => {
      tryUpdateLastUsed(profileName);
      resolve({ exitCode: code ?? 1 });
    });
  });
}

/**
 * Run gws auth status for a profile (captured output for parsing).
 */
export function runGwsAuthStatus(profileName: string): {
  exitCode: number;
  status: Record<string, unknown> | null;
} {
  const result = runGws({ profileName, args: ['auth', 'status'], capture: true });

  let status: Record<string, unknown> | null = null;
  if (result.stdout) {
    try {
      status = JSON.parse(result.stdout);
    } catch {
      // gws auth status may output non-JSON on some errors
    }
  }

  return { exitCode: result.exitCode, status };
}

/**
 * Resolve the Google identity (email) bound to a profile by querying gws.
 *
 * Tries scope-appropriate endpoints in order so it works for any profile that
 * has at least one of: gmail, calendar. Returns null if no endpoint succeeds.
 */
export function fetchProfileEmail(profileName: string): string | null {
  // Strategy 1: gmail.users.getProfile — most common, returns emailAddress.
  const gmail = runGws({
    profileName,
    args: ['gmail', 'users', 'getProfile', '--params', '{"userId":"me"}'],
    capture: true,
  });
  if (gmail.exitCode === 0 && gmail.stdout) {
    const email = extractEmailFromJson(gmail.stdout);
    if (email) return email;
  }

  // Strategy 2: calendar.calendarList.get('primary') — id is the user's email
  // for primary on consumer accounts and Workspace.
  const cal = runGws({
    profileName,
    args: ['calendar', 'calendarList', 'get', '--params', '{"calendarId":"primary"}'],
    capture: true,
  });
  if (cal.exitCode === 0 && cal.stdout) {
    const email = extractEmailFromJson(cal.stdout);
    if (email) return email;
  }

  return null;
}

function extractEmailFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  // gmail.users.getProfile shape
  if (typeof obj['emailAddress'] === 'string') {
    return obj['emailAddress'] as string;
  }
  // calendar.calendarList primary shape — `id` is the email for primary.
  if (typeof obj['id'] === 'string' && (obj['id'] as string).includes('@')) {
    return obj['id'] as string;
  }
  return null;
}
