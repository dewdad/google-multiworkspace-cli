import { checkGwsBinary } from '../gws/binary.js';
import { listAllProfiles } from '../profiles/index.js';
import { CONFIG_ROOT } from '../profiles/config.js';
import { GWCLI_VERSION } from '../version.js';
import type { DoctorCheck } from '../types/index.js';

export async function runDoctor(): Promise<void> {
  const checks: DoctorCheck[] = [];

  // 1. Check gws binary
  const gwsInfo = checkGwsBinary();
  if (gwsInfo) {
    checks.push({
      name: 'gws binary',
      status: 'ok',
      message: `v${gwsInfo.version} (${gwsInfo.path})`,
    });
  } else {
    checks.push({
      name: 'gws binary',
      status: 'error',
      message: 'Not found on PATH',
      suggestion: 'Install: npm install -g @googleworkspace/cli',
    });
  }

  // 2. Config directory
  checks.push({
    name: 'Config directory',
    status: 'ok',
    message: CONFIG_ROOT,
  });

  // 3. Profiles
  const profiles = listAllProfiles();
  if (profiles.length === 0) {
    checks.push({
      name: 'Profiles',
      status: 'warn',
      message: 'No profiles configured',
      suggestion: 'Create one: gwcli init <name>',
    });
  } else {
    for (const profile of profiles) {
      const marker = profile.isDefault ? ' (default)' : '';
      if (profile.authenticated) {
        checks.push({
          name: `Profile: ${profile.name}${marker}`,
          status: 'ok',
          message: `${profile.email ?? 'no email'} — ${profile.scopes.length} scopes`,
        });
      } else {
        checks.push({
          name: `Profile: ${profile.name}${marker}`,
          status: 'error',
          message: 'Not authenticated',
          suggestion: `Run: gwcli profiles auth ${profile.name}`,
        });
      }
    }
  }

  // Print results
  console.log(`gwcli  ${GWCLI_VERSION}`);
  if (gwsInfo) {
    console.log(`gws    v${gwsInfo.version}`);
  }
  console.log('');

  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${check.name}: ${check.message}`);
    if (check.suggestion) {
      console.log(`    → ${check.suggestion}`);
    }
  }
}
