import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { MgwsError } from '../types/index.js';
import { SCOPE_CAP } from '../profiles/scopes.js';

// ─── Cap-exempt OAuth client walkthrough ─────────────────────────────────────
//
// When a profile requests more OAuth scopes than the built-in (testing-mode)
// client can grant (~25), consent fails. This module runs an interactive
// walkthrough that guides the user to a cap-exempt OAuth client — an Internal
// Workspace app (admin-configured) or a verified app — and returns the path to
// its downloaded `client_secret.json`. The onboarding gate (`onboard.ts`) wires
// it in; it degrades to a non-blocking `null` in non-TTY (agent/CI) so callers
// surface a `SCOPE_CAP_EXCEEDED` remediation instead of hanging on stdin.

export interface CapPromptContext {
  /** Profile being onboarded — surfaced in the guidance text. */
  profileName: string;
  /** Resolved service list (ignored when `fullAccess`). */
  scopes: string[];
  /** True when `--full` was requested. */
  fullAccess: boolean;
}

/** Expand a leading `~` — the shell does NOT expand hand-typed readline input. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return resolve(homedir(), p.slice(2));
  return p;
}

function describeRequest(ctx: CapPromptContext): string {
  if (ctx.fullAccess) return 'full access (ALL scopes, incl. Pub/Sub + Cloud Platform)';
  return `${ctx.scopes.length} services (${ctx.scopes.join(', ')})`;
}

/** Print the cap explanation + Internal-Workspace-app steps to stderr. */
function printCapGuidance(ctx: CapPromptContext): void {
  const w = (s: string): void => {
    process.stderr.write(s + '\n');
  };
  w('');
  w(`⚠ Profile '${ctx.profileName}' requests ${describeRequest(ctx)}.`);
  w(`  This exceeds Google's ~${SCOPE_CAP}-scope limit for mgws's built-in`);
  w('  (unverified, testing-mode) OAuth client, so consent would fail.');
  w('');
  w('  To grant this many scopes you need a cap-exempt OAuth client — an');
  w('  Internal Workspace app (admin-configured) or a Verified app. Steps for');
  w('  an Internal Workspace app (requires a Google Workspace admin):');
  w('    1. Google Cloud Console → APIs & Services → OAuth consent screen');
  w('       → User type: Internal');
  w('    2. Credentials → Create Credentials → OAuth client ID');
  w('       → Application type: Desktop app');
  w('    3. Download the JSON (the secret is shown once — capture it now)');
  w('  Full guide: multi-gws/references/oauth-bootstrap.md');
  w('');
}

/**
 * Interactively obtain a cap-exempt `client_secret.json` path.
 *
 * Returns the resolved path, or `null` to abort (empty input, or non-TTY where
 * we must never block). Throws `CLIENT_SECRET_NOT_FOUND` if the given path does
 * not exist. Guidance + prompt go to **stderr** so stdout stays clean for
 * machine-readable output.
 */
export async function promptForCapExemptClient(ctx: CapPromptContext): Promise<string | null> {
  // Non-interactive (agent/CI): never block on stdin. Return null so the caller
  // surfaces the SCOPE_CAP_EXCEEDED remediation instead of hanging forever.
  if (!process.stdin.isTTY) return null;

  printCapGuidance(ctx);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (
      await rl.question('Path to your Internal/verified client_secret.json (Enter to cancel): ')
    ).trim();
    if (!answer) return null;
    const clientPath = resolve(expandHome(answer));
    if (!existsSync(clientPath)) {
      throw new MgwsError(
        `Client secret file not found: ${clientPath}`,
        'CLIENT_SECRET_NOT_FOUND',
        'Download the OAuth client JSON from Google Cloud Console and pass its path.'
      );
    }
    return clientPath;
  } finally {
    rl.close();
  }
}
