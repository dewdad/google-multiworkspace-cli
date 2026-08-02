import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { CONFIG_ROOT, PROFILES_DIR } from '../profiles/config.js';

interface SetupStep {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  detail?: string;
}

interface SetupOptions {
  json?: boolean;
  /** If provided, install this exact version of gws. Defaults to latest. */
  gwsVersion?: string;
}

const GWS_PACKAGE = '@googleworkspace/cli';
const MIN_GWS_VERSION = '0.20.0';

export interface EnsureSetupResult {
  success: boolean;
  steps: SetupStep[];
}

/**
 * Run the idempotent setup steps (verify mgws, install/verify gws, create
 * config dirs) WITHOUT emitting output or exiting the process.
 *
 * Extracted so orchestrators like `mgws init` can guarantee gws is installed
 * before adding a profile, then render their own summary. `runSetup` wraps this
 * with human/JSON output and a process exit.
 */
export function ensureSetup(gwsVersion?: string): EnsureSetupResult {
  const steps: SetupStep[] = [];

  // 1. Verify mgws is invokable (trivially true: we're it)
  steps.push({ name: 'mgws', status: 'ok', detail: 'present' });

  // 2. Verify gws package exists on registry before attempting install
  steps.push(verifyPackageAvailable(GWS_PACKAGE));

  // 3. Install / verify gws
  steps.push(installGws(gwsVersion));

  // 4. Verify gws version meets minimum
  steps.push(verifyGwsVersion());

  // 5. Create config directory tree
  steps.push(createConfigDirs());

  return { success: steps.every(s => s.status !== 'error'), steps };
}

/**
 * Install gws and verify dependencies. Idempotent.
 *
 * Bootstrapping note: mgws itself must already be installed for this command
 * to run. Users install mgws via
 * `npm install -g github:dewdad/multi-gws`
 * (the package is not on the npm registry yet), then `mgws setup` handles the
 * rest (gws + config dirs).
 */
export async function runSetup(options: SetupOptions = {}): Promise<void> {
  const { success, steps } = ensureSetup(options.gwsVersion);

  if (options.json) {
    process.stdout.write(JSON.stringify({ success, steps }, null, 2) + '\n');
  } else {
    for (const step of steps) {
      const icon = step.status === 'ok' ? '✓' : step.status === 'skipped' ? '○' : '✗';
      process.stdout.write(`  ${icon} ${step.name}${step.detail ? ': ' + step.detail : ''}\n`);
    }
    if (success) {
      process.stdout.write('\nSetup complete. Add your first Google account — the built-in OAuth client\n');
      process.stdout.write('means no --client is needed:\n');
      process.stdout.write('  mgws init <name>            # one step: create profile + authenticate\n');
      process.stdout.write('  mgws profiles add <name>    # same, without the setup pre-check\n');
    } else {
      process.stdout.write('\nSetup failed. See errors above.\n');
    }
  }

  process.exit(success ? 0 : 1);
}

function verifyPackageAvailable(pkg: string): SetupStep {
  try {
    execSync(`npm view ${pkg} version`, {
      stdio: 'pipe',
      timeout: 30_000,
      shell: process.platform === 'win32' ? true : undefined,
    } as Parameters<typeof execSync>[1]);
    return { name: `verify ${pkg}`, status: 'ok', detail: 'available on npm registry' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: `verify ${pkg}`,
      status: 'error',
      detail: `npm registry lookup failed: ${msg.split('\n')[0]}`,
    };
  }
}

function installGws(version?: string): SetupStep {
  // Already installed?
  try {
    const out = execSync('gws --version', {
      stdio: 'pipe',
      timeout: 10_000,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? true : undefined,
    } as Parameters<typeof execSync>[1]).toString().trim();
    return { name: 'install gws', status: 'skipped', detail: `already installed: ${out.split('\n')[0]}` };
  } catch {
    // Not installed — proceed
  }

  try {
    const target = version ? `${GWS_PACKAGE}@${version}` : GWS_PACKAGE;
    execSync(`npm install -g ${target}`, {
      stdio: 'pipe',
      timeout: 180_000,
      shell: process.platform === 'win32' ? true : undefined,
    } as Parameters<typeof execSync>[1]);
    return { name: 'install gws', status: 'ok', detail: `installed via npm` };
  } catch (err) {
    return {
      name: 'install gws',
      status: 'error',
      detail: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

function verifyGwsVersion(): SetupStep {
  try {
    const out = execSync('gws --version', {
      stdio: 'pipe',
      timeout: 10_000,
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? true : undefined,
    } as Parameters<typeof execSync>[1]).toString().trim();
    const match = out.match(/(\d+\.\d+\.\d+)/);
    if (!match) {
      return { name: 'verify gws version', status: 'error', detail: `cannot parse version from: ${out.split('\n')[0]}` };
    }
    const version = match[1]!;
    if (compareSemver(version, MIN_GWS_VERSION) < 0) {
      return {
        name: 'verify gws version',
        status: 'error',
        detail: `gws ${version} is below minimum ${MIN_GWS_VERSION}. Run: npm update -g ${GWS_PACKAGE}`,
      };
    }
    return { name: 'verify gws version', status: 'ok', detail: `v${version} >= ${MIN_GWS_VERSION}` };
  } catch (err) {
    return {
      name: 'verify gws version',
      status: 'error',
      detail: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}

function createConfigDirs(): SetupStep {
  try {
    if (!existsSync(CONFIG_ROOT)) mkdirSync(CONFIG_ROOT, { recursive: true });
    if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
    return { name: 'config dirs', status: 'ok', detail: CONFIG_ROOT };
  } catch (err) {
    return {
      name: 'config dirs',
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Only handles X.Y.Z numeric semver (no prerelease tags).
 *
 * Exported for unit-testing. Not part of the public CLI surface.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}
