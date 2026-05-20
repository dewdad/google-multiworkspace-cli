#!/usr/bin/env node
/**
 * gwcli wrapper — resolves and executes gwcli.
 * Priority: global install → npx → local build (skill-relative).
 *
 * This wrapper exists so the skill can always point to `$SKILL_DIR/bin/gwcli.mjs`
 * regardless of how the user installed the CLI.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = dirname(__dirname);
const args = process.argv.slice(2);
const IS_WIN = process.platform === 'win32';

// Strategy 1: Global gwcli
// On Windows, npm globals install as .cmd shims that require shell:true
// to be invoked via execSync/spawnSync. Without the flag, the probe always
// throws and we fall through to the slow npx path on every invocation.
function tryGlobal() {
  try {
    execSync('gwcli --version', { stdio: 'pipe', timeout: 5000, shell: IS_WIN });
    return 'gwcli';
  } catch {
    return null;
  }
}

// Strategy 2: Local build in skill's parent project
function tryLocalBuild() {
  // If installed via skillshare from this repo, dist/ might be alongside skill/
  const distIndex = join(SKILL_DIR, '..', 'dist', 'index.js');
  if (existsSync(distIndex)) {
    return `node ${distIndex}`;
  }
  return null;
}

// Strategy 3: npx (slow path — clones from GitHub each invocation unless cached
// by npx). Used only when neither a global install nor an alongside `dist/`
// build is available. The package is not on the npm registry yet (see Issue 1
// in plans/install-and-bootstrap-fixes), so the install vector is the repo URL.
function tryNpx() {
  return 'npx --yes github:dewdad/google-multiworkspace-cli';
}

const command = tryGlobal() || tryLocalBuild() || tryNpx();

if (command === 'gwcli') {
  // Direct spawn for global install. shell:true on Windows for .cmd shims;
  // on POSIX, avoid shell to prevent argument-quoting surprises.
  const result = spawnSync('gwcli', args, { stdio: 'inherit', shell: IS_WIN });
  process.exit(result.status ?? 1);
} else if (command.startsWith('node ')) {
  // Local build
  const script = command.replace('node ', '');
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  // npx fallback (npm/npx are .cmd on Windows, plain executables elsewhere)
  const result = spawnSync(command.split(' ')[0], [...command.split(' ').slice(1), ...args], {
    stdio: 'inherit',
    shell: IS_WIN,
  });
  process.exit(result.status ?? 1);
}
