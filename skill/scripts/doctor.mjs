#!/usr/bin/env node
/**
 * Doctor — comprehensive health check. Returns JSON diagnostic.
 * Use when things are broken. For routine checks, use preflight.mjs.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const IS_WIN = platform() === 'win32';

function getConfigRoot() {
  if (process.env.GWCLI_CONFIG_DIR) return process.env.GWCLI_CONFIG_DIR;
  return IS_WIN
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'gwcli')
    : join(homedir(), '.config', 'gwcli');
}

const report = {
  timestamp: new Date().toISOString(),
  platform: platform(),
  node: process.versions.node,
  checks: [],
  profiles: [],
  recommendations: [],
};

function check(name, fn) {
  try {
    const detail = fn();
    report.checks.push({ name, status: 'ok', detail });
  } catch (e) {
    report.checks.push({ name, status: 'error', detail: e.message });
  }
}

// Node version
check('node-version', () => {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) throw new Error(`v${process.versions.node} — requires >= 18`);
  return `v${process.versions.node}`;
});

// gws binary
check('gws-binary', () => {
  const stdout = execSync('gws --version', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
  const match = stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? `v${match[1]}` : stdout.split('\n')[0];
});

// gwcli binary
check('gwcli-binary', () => {
  execSync('gwcli version-info', { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
  return 'available';
});

// Config directory
check('config-dir', () => {
  const root = getConfigRoot();
  if (!existsSync(root)) throw new Error(`Missing: ${root}`);
  return root;
});

// Profiles
const configRoot = getConfigRoot();
const profilesDir = join(configRoot, 'profiles');
if (existsSync(profilesDir)) {
  const dirs = readdirSync(profilesDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const dir of dirs) {
    const profileDir = join(profilesDir, dir.name);
    const metaPath = join(profileDir, 'meta.json');
    const gwsDir = join(profileDir, 'gws');
    const profile = { name: dir.name, status: 'unknown', email: null, scopes: [] };

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        profile.email = meta.email;
        profile.scopes = meta.scopes || [];
        profile.status = meta.email ? 'authenticated' : 'not-authenticated';
      } catch {
        profile.status = 'corrupted-meta';
      }
    } else {
      profile.status = 'missing-meta';
    }

    if (!existsSync(gwsDir)) {
      profile.status = 'missing-gws-dir';
    }

    report.profiles.push(profile);
  }
}

// Recommendations
const errors = report.checks.filter(c => c.status === 'error');
if (errors.find(e => e.name === 'gws-binary')) {
  report.recommendations.push('Install gws: npm install -g @googleworkspace/cli');
}
if (errors.find(e => e.name === 'gwcli-binary')) {
  report.recommendations.push('Install gwcli: npm install -g google-workspace-cli');
}
if (report.profiles.length === 0) {
  report.recommendations.push('Add a profile: gwcli profiles add <name> --client <oauth-secret.json>');
}
const expired = report.profiles.filter(p => p.status === 'not-authenticated');
for (const p of expired) {
  report.recommendations.push(`Re-authenticate: gwcli profiles auth ${p.name}`);
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(errors.length > 0 ? 1 : 0);
