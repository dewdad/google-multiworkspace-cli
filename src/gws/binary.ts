import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path';
import { platform } from 'node:os';
import { MgwsError, type GwsBinaryInfo } from '../types/index.js';
import { getGlobalConfig } from '../profiles/config.js';

export interface GwsSpawnCommand {
  command: string;
  argsPrefix: string[];
}

/**
 * Locate the gws binary and verify it can execute.
 * Uses the configured gwsBinary path (default: "gws" from PATH).
 */
export function findGwsBinary(): GwsBinaryInfo {
  const config = getGlobalConfig();
  const binary = config.gwsBinary;
  const spawnCommand = resolveGwsSpawnCommand(binary);

  const result = spawnSync(spawnCommand.command, [...spawnCommand.argsPrefix, '--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });

  if (result.error) {
    throw new MgwsError(
      `Cannot find gws binary: '${binary}'`,
      'GWS_NOT_FOUND',
      'Install gws: npm install -g @googleworkspace/cli\nOr set custom path in ~/.config/mgws/config.json → gwsBinary'
    );
  }

  if (result.status !== 0) {
    throw new MgwsError(
      `gws binary at '${binary}' returned error on --version check.`,
      'GWS_VERSION_FAILED',
      `stderr: ${result.stderr?.trim() ?? '(empty)'}`
    );
  }

  // Parse version from output: "gws 0.22.5\nThis is not an officially supported Google product."
  const stdout = result.stdout?.trim() ?? '';
  const versionMatch = stdout.match(/^gws\s+([\d.]+)/);
  const version = versionMatch?.[1] ?? 'unknown';

  return { path: binary, version };
}

/**
 * Get the gws binary path from config (without verifying).
 * Use for subprocess spawning where we don't want the overhead of version check.
 */
export function getGwsBinaryPath(): string {
  return getGlobalConfig().gwsBinary;
}

/**
 * Resolve the command used for child_process.spawnSync without shell mode.
 *
 * On Windows, npm package shims are .cmd/.ps1 files, which require a shell.
 * For the default global gws install, run the package entrypoint directly with
 * the current Node executable instead.
 */
export function resolveGwsSpawnCommand(binary: string): GwsSpawnCommand {
  if (platform() !== 'win32') {
    return { command: binary, argsPrefix: [] };
  }

  if (extname(binary).toLowerCase() === '.js') {
    return { command: process.execPath, argsPrefix: [binary] };
  }

  const npmShim = findWindowsNpmShim(binary);
  if (npmShim) {
    const runJs = join(dirname(npmShim), 'node_modules', '@googleworkspace', 'cli', 'run.js');
    if (existsSync(runJs)) {
      return { command: process.execPath, argsPrefix: [runJs] };
    }
  }

  return { command: binary, argsPrefix: [] };
}

function findWindowsNpmShim(binary: string): string | null {
  const normalized = binary.replace(/\//g, '\\');
  const ext = extname(normalized).toLowerCase();
  const candidates = ext === '.cmd'
    ? [normalized]
    : ext === ''
      ? [`${normalized}.cmd`]
      : [];

  for (const candidate of candidates) {
    if (isAbsolute(candidate) && existsSync(candidate)) {
      return candidate;
    }

    for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
      if (!dir) continue;
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Check that gws is available, returning null if not found (non-throwing).
 */
export function checkGwsBinary(): GwsBinaryInfo | null {
  try {
    return findGwsBinary();
  } catch {
    return null;
  }
}
