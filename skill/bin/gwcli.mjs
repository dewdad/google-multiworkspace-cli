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

// Strategy 1: Global gwcli
function tryGlobal() {
  try {
    execSync('gwcli --version', { stdio: 'pipe', timeout: 5000 });
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

// Strategy 3: npx
function tryNpx() {
  return 'npx --yes google-workspace-cli';
}

const command = tryGlobal() || tryLocalBuild() || tryNpx();

if (command === 'gwcli') {
  // Direct spawn for global install
  const result = spawnSync('gwcli', args, { stdio: 'inherit', shell: true });
  process.exit(result.status ?? 1);
} else if (command.startsWith('node ')) {
  // Local build
  const script = command.replace('node ', '');
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  // npx fallback
  const result = spawnSync(command.split(' ')[0], [...command.split(' ').slice(1), ...args], {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(result.status ?? 1);
}
