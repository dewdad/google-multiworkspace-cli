#!/usr/bin/env node
/**
 * Preflight check — fast (<100ms) dependency verification.
 * Exit codes: 0=ready, 1=Node too old, 2=gwcli missing, 3=gws missing, 4=no profiles
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

// Check Node version
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  process.stderr.write(JSON.stringify({ error: 'node_version', minimum: 18, current: major }));
  process.exit(1);
}

// Resolve gwcli — check global install
function findGwcli() {
  try {
    execSync('gwcli version-info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Check gws binary
function findGws() {
  try {
    const result = execSync('gws --version', { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' });
    return result.includes('gws');
  } catch {
    return false;
  }
}

// Check profiles exist (filesystem check — fast, no subprocess)
function hasProfiles() {
  const configRoot = platform() === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gwcli')
    : join(homedir(), '.config', 'gwcli');
  const profilesDir = join(configRoot, 'profiles');
  if (!existsSync(profilesDir)) return false;
  try {
    const entries = readdirSync(profilesDir, { withFileTypes: true });
    return entries.some(e => e.isDirectory());
  } catch {
    return false;
  }
}

if (!findGwcli()) {
  process.stderr.write(JSON.stringify({ error: 'gwcli_missing', fix: 'Run: node "$SKILL_DIR/scripts/setup.mjs"' }));
  process.exit(2);
}

if (!findGws()) {
  process.stderr.write(JSON.stringify({ error: 'gws_missing', fix: 'Run: node "$SKILL_DIR/scripts/setup.mjs"' }));
  process.exit(3);
}

if (!hasProfiles()) {
  process.stderr.write(JSON.stringify({ error: 'no_profiles', fix: 'gwcli profiles add <name> --client <path>' }));
  process.exit(4);
}

// All good — silent exit
process.exit(0);
