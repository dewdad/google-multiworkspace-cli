#!/usr/bin/env node
/**
 * Setup script — installs gwcli and gws dependencies.
 * Cross-platform (Windows, macOS, Linux). Idempotent.
 *
 * Actions:
 * 1. Verify Node.js >= 18
 * 2. Install @googleworkspace/cli (gws) globally if missing
 * 3. Install google-workspace-cli (gwcli) globally if missing
 * 4. Create config directory structure
 * 5. Report status as JSON
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const IS_WIN = platform() === 'win32';
const log = (msg) => process.stderr.write(`[setup] ${msg}\n`);
const result = { steps: [], success: true };

function step(name, fn) {
  try {
    const output = fn();
    result.steps.push({ name, status: 'ok', output });
    log(`✓ ${name}`);
  } catch (e) {
    result.steps.push({ name, status: 'error', error: e.message });
    log(`✗ ${name}: ${e.message}`);
    result.success = false;
  }
}

// Step 1: Verify Node
step('check-node', () => {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) throw new Error(`Node.js ${major} is too old. Requires >= 18.`);
  return `v${process.versions.node}`;
});

// Step 2: Install gws globally
step('install-gws', () => {
  const shellOpt = IS_WIN ? { shell: true } : {};
  try {
    const ver = execSync('gws --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', ...shellOpt }).trim();
    return `already installed: ${ver}`;
  } catch {
    // Verify package exists on registry before attempting install (defends against typos
    // and registry outages that would otherwise produce a confusing npm error).
    log('  Verifying @googleworkspace/cli is published...');
    try {
      execSync('npm view @googleworkspace/cli version', { stdio: 'pipe', timeout: 30000, ...shellOpt });
    } catch (e) {
      throw new Error(`@googleworkspace/cli not resolvable on the npm registry: ${e.message.split('\n')[0]}`);
    }
    log('  Installing @googleworkspace/cli globally...');
    execSync('npm install -g @googleworkspace/cli', { stdio: 'pipe', timeout: 120000, ...shellOpt });
    const ver = execSync('gws --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', ...shellOpt }).trim();
    return `installed: ${ver}`;
  }
});

// Step 3: Install gwcli globally
step('install-gwcli', () => {
  const shellOpt = IS_WIN ? { shell: true } : {};
  try {
    execSync('gwcli --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', ...shellOpt });
    return 'already installed';
  } catch {
    log('  Installing google-workspace-cli globally...');
    execSync('npm install -g google-workspace-cli', { stdio: 'pipe', timeout: 120000, ...shellOpt });
    return 'installed';
  }
});

// Step 4: Create config directory
step('config-dir', () => {
  const configRoot = IS_WIN
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gwcli')
    : join(homedir(), '.config', 'gwcli');
  const profilesDir = join(configRoot, 'profiles');

  if (!existsSync(configRoot)) mkdirSync(configRoot, { recursive: true });
  if (!existsSync(profilesDir)) mkdirSync(profilesDir, { recursive: true });

  return configRoot;
});

// Step 5: Verify gws version compatibility
step('verify-compat', () => {
  const shellOpt = IS_WIN ? { shell: true } : {};
  try {
    const stdout = execSync('gws --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe', ...shellOpt });
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    const version = match ? match[1] : 'unknown';
    const [major, minor] = version.split('.').map(Number);
    if (major === 0 && minor < 20) {
      throw new Error(`gws ${version} is outdated. Run: npm update -g @googleworkspace/cli`);
    }
    return version;
  } catch (e) {
    if (e.message.includes('outdated')) throw e;
    throw new Error('Could not verify gws version');
  }
});

// Output
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.success ? 0 : 1);
