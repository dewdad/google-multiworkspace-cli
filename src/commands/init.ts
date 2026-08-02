import { createInterface } from 'node:readline/promises';
import { ensureSetup } from './setup.js';
import { addAndAuthProfile, resolveScopeList } from './onboard.js';
import { profileExists, getProfileMeta, hasAuthArtifacts } from '../profiles/config.js';
import { runGwsAuthLogin } from '../gws/runner.js';
import { refreshProfileEmail } from '../profiles/index.js';
import { DEFAULT_SERVICES, isFullAccess } from '../profiles/scopes.js';
import { MgwsError } from '../types/index.js';

export interface InitOptions {
  scopes?: string;
  client?: string;
  full?: boolean;
  displayName?: string;
  /** Commander maps `--no-auth` to `auth: false`. */
  auth?: boolean;
  incognito?: boolean;
  open?: boolean;
  gwsVersion?: string;
  json?: boolean;
  /** Non-interactive: never prompt, accept defaults. */
  yes?: boolean;
}

interface InitSummary {
  success: boolean;
  profile: string;
  created: boolean;
  authenticated: boolean;
  email: string | null;
  isDefault: boolean;
}

async function promptLine(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/**
 * One-step onboarding: ensure gws is installed, then create + authenticate a
 * profile (auto-set as default when it's the first). Agent-first — fully
 * flag/JSON driven and non-interactive by default in a non-TTY; falls back to
 * light prompts only in an interactive terminal without `--yes`/`--json`.
 */
export async function runInit(nameArg: string | undefined, options: InitOptions = {}): Promise<void> {
  const interactive = !!process.stdin.isTTY && options.yes !== true && options.json !== true;
  const emit = (summary: InitSummary): void => {
    if (options.json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    }
  };

  // 1. Ensure gws + config dirs (idempotent). No process exit here — we own the report.
  const setup = ensureSetup(options.gwsVersion);
  if (!setup.success) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ success: false, error: 'setup_failed', steps: setup.steps }, null, 2) + '\n');
    } else {
      for (const step of setup.steps) {
        if (step.status === 'error') process.stderr.write(`✗ ${step.name}: ${step.detail ?? ''}\n`);
      }
      process.stderr.write('\nSetup failed — could not install/verify gws. Fix the errors above and retry.\n');
    }
    process.exit(1);
  }

  // 2. Resolve the profile name.
  let name = nameArg;
  if (!name) {
    if (interactive) {
      name = await promptLine('Profile name [personal]: ', 'personal');
    } else {
      throw new MgwsError(
        'A profile name is required.',
        'INIT_NEEDS_NAME',
        'Provide one, e.g.: mgws init personal'
      );
    }
  }

  // 3. Idempotent: if the profile already exists, don't recreate it. Re-auth
  //    only when it isn't already authenticated and auth wasn't disabled.
  if (profileExists(name)) {
    const alreadyAuthed = hasAuthArtifacts(name);
    if (alreadyAuthed || options.auth === false) {
      if (!options.json) {
        console.log(
          alreadyAuthed
            ? `Profile '${name}' already exists and is authenticated. Nothing to do.`
            : `Profile '${name}' already exists (not authenticated). Run: mgws profiles auth ${name}`
        );
      }
      emit({ success: true, profile: name, created: false, authenticated: alreadyAuthed, email: getProfileMeta(name)?.email ?? null, isDefault: false });
      return;
    }

    if (!options.json) console.log(`Profile '${name}' already exists — authenticating...`);
    const meta = getProfileMeta(name);
    const storedScopes = meta?.scopes;
    const result = await runGwsAuthLogin(name, storedScopes, {
      incognito: options.incognito as boolean,
      autoOpen: options.open as boolean,
      fullAccess: isFullAccess(storedScopes),
    });
    if (result.exitCode !== 0) {
      throw new MgwsError(`Authentication failed for profile '${name}' (exit ${result.exitCode}).`, 'AUTH_FAILED', `Re-run: mgws profiles auth ${name}`);
    }
    let email: string | null = null;
    try { email = refreshProfileEmail(name); } catch { /* non-fatal */ }
    if (!options.json && email) console.log(`Identity: ${email}`);
    emit({ success: true, profile: name, created: false, authenticated: true, email, isDefault: false });
    return;
  }

  // 4. Resolve scopes. In an interactive terminal, offer a one-line override of
  //    the default service set (Enter keeps the default).
  let scopeCsv = options.scopes;
  if (interactive && options.full !== true && scopeCsv === undefined) {
    const answer = await promptLine(
      `Services to grant [${DEFAULT_SERVICES.join(',')}]\n(comma-separated, Enter for default): `,
      ''
    );
    if (answer) scopeCsv = answer;
  }
  const { scopes, fullAccess } = resolveScopeList({ full: options.full, scopes: scopeCsv });

  // 5. Create + authenticate (auto-sets default when first).
  const result = await addAndAuthProfile(name, {
    clientSecretPath: options.client,
    displayName: options.displayName,
    scopes,
    fullAccess,
    auth: options.auth !== false,
    incognito: options.incognito as boolean,
    autoOpen: options.open as boolean,
    onCreated: () => {
      if (options.json) return;
      console.log(`Profile '${name}' created.`);
      if (fullAccess) console.log('Full-access mode: requesting ALL scopes (incl. Pub/Sub + Cloud Platform).');
      if (options.auth !== false) console.log('Starting authentication...');
    },
  });

  // 6. Report.
  if (!options.json) {
    if (result.authenticated) {
      console.log(`Profile '${name}' authenticated successfully.`);
      if (result.email) console.log(`Identity: ${result.email}`);
    } else {
      console.log(`Skipping auth. Run later: mgws profiles auth ${name}`);
    }
    if (result.isDefault) console.log(`Set as the default profile.`);
    console.log(`\nReady. Try: mgws --profile ${name} agenda --days 7`);
  }
  emit({ success: true, profile: name, created: true, authenticated: result.authenticated, email: result.email, isDefault: result.isDefault });
}
