import { spawnSync } from 'node:child_process';
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
 * Run gws auth login for a profile.
 * Opens browser for OAuth flow.
 */
export function runGwsAuthLogin(profileName: string, services?: string[]): GwsRunResult {
  const args = ['auth', 'login'];

  if (services && services.length > 0) {
    args.push('--services', services.join(','));
  }

  return runGws({ profileName, args, capture: false });
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
