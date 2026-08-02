#!/usr/bin/env node

import { Command } from 'commander';
import { registerProfilesCommands } from './commands/profiles.js';
import { resolveProfile } from './profiles/resolver.js';
import { execGwsPassthrough } from './gws/runner.js';
import { findGwsBinary } from './gws/binary.js';
import { runDoctor } from './commands/doctor.js';
import { runMigrate } from './commands/migrate.js';
import { runPreflight } from './commands/preflight.js';
import { runSetup } from './commands/setup.js';
import { runInit } from './commands/init.js';
import { runAgenda } from './commands/agenda.js';
import { tryTranslateCompat } from './compat/translations.js';
import { GwcliError } from './types/index.js';
import { GWCLI_VERSION } from './version.js';

const program = new Command();

program
  .name('gwcli')
  .description('Multi-profile Google Workspace CLI — orchestration layer over gws')
  .version(GWCLI_VERSION)
  .option('-p, --profile <name>', 'Select profile for this invocation')
  .option('-f, --format <fmt>', 'Output format: json, table, yaml, csv')
  .option('-v, --verbose', 'Show debug info (profile resolution, gws command)')
  .allowUnknownOption(true)
  .allowExcessArguments(true);

// ─── Native Commands ─────────────────────────────────────────────────────────

registerProfilesCommands(program);

program
  .command('doctor')
  .description('Check system health')
  .action(async () => {
    await runDoctor();
  });

program
  .command('migrate')
  .description('Migrate v1 profiles to new format')
  .option('--client <path>', 'Path to OAuth client secret JSON')
  .option('--profile <name>', 'Migrate specific profile only')
  .option('--no-auth', 'Skip re-authentication after migration')
  .action(async (options) => {
    await runMigrate(options);
  });

program
  .command('version-info')
  .description('Show version info for gwcli and gws')
  .action(() => {
    const gwsInfo = findGwsBinary();
    console.log(`gwcli  ${GWCLI_VERSION}`);
    console.log(`gws    ${gwsInfo.version}  (${gwsInfo.path})`);
  });

program
  .command('preflight')
  .description('Fast dependency check (gws + at least one profile). Silent on success.')
  .option('--json', 'Emit a JSON report on stderr (silent on success otherwise)')
  .action(async (options) => {
    await runPreflight(options);
  });

program
  .command('setup')
  .description('Install gws and create config directories. Idempotent.')
  .option('--json', 'Emit JSON report instead of human-readable output')
  .option('--gws-version <version>', 'Pin a specific gws version (default: latest)')
  .action(async (options) => {
    await runSetup({ json: options.json, gwsVersion: options.gwsVersion });
  });

program
  .command('init [name]')
  .description('One-step onboarding: ensure gws, create a profile, authenticate, set as default')
  .option('--scopes <list>', 'Comma-separated service names (default: mainstream Workspace services)')
  .option('--client <path>', 'Custom OAuth client JSON (optional — uses the built-in client if omitted)')
  .option('--full', 'Request ALL scopes (incl. Pub/Sub + Cloud Platform)')
  .option('--display-name <name>', 'Human-friendly display name')
  .option('--no-auth', 'Scaffold the profile without authenticating')
  .option('--no-incognito', 'Open the OAuth URL in the default browser session instead of a private window')
  .option('--no-open', 'Do not auto-launch a browser for the OAuth URL (headless/agent/CI); print it instead')
  .option('--gws-version <version>', 'Pin a specific gws version during install (default: latest)')
  .option('--json', 'Emit a JSON summary')
  .option('-y, --yes', 'Non-interactive: accept defaults, never prompt')
  .action(async (name: string | undefined, options) => {
    await runInit(name, {
      scopes: options.scopes,
      client: options.client,
      full: options.full,
      displayName: options.displayName,
      auth: options.auth,
      incognito: options.incognito,
      open: options.open,
      gwsVersion: options.gwsVersion,
      json: options.json,
      yes: options.yes,
    });
  });

// `gwcli agenda` — native, profile-aware shortcut for "what's on my calendar?"
// Implemented natively (composes events.list with timeMin/timeMax) so it works
// regardless of whether the underlying gws supports a `+agenda` shortcut.
program
  .command('agenda')
  .description('Show upcoming calendar events for the next N days')
  .option('-d, --days <n>', 'Number of days ahead to fetch (default: 7)', '7')
  .option('-c, --calendar <id>', 'Calendar ID (default: primary)', 'primary')
  .option('--max <n>', 'Max events to return (default: 50)', '50')
  .action((opts) => {
    const profileFlag = program.opts().profile as string | undefined;
    const formatFlag = program.opts().format as string | undefined;
    runAgenda({
      profileFlag,
      formatFlag,
      days: Number(opts.days),
      calendarId: opts.calendar,
      maxResults: Number(opts.max),
    });
  });

// ─── Passthrough: Everything else goes to gws ────────────────────────────────

// ─── Arg Parser (extract gwcli flags, leave rest for gws) ────────────────────

interface ParsedArgs {
  profileFlag?: string;
  formatFlag?: string;
  verbose: boolean;
  gwsArgs: string[];
}

const NATIVE_COMMANDS = new Set([
  'profiles',
  'doctor',
  'version-info',
  'migrate',
  'preflight',
  'setup',
  'init',
  'agenda',
  'help',
]);

function parseGwcliArgs(rawArgs: string[]): ParsedArgs {
  let profileFlag: string | undefined;
  let formatFlag: string | undefined;
  let verbose = false;
  const gwsArgs: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i]!;

    // Explicit passthrough separator
    if (arg === '--') {
      gwsArgs.push(...rawArgs.slice(i + 1));
      break;
    }

    // gwcli global flags
    if ((arg === '--profile' || arg === '-p') && i + 1 < rawArgs.length) {
      profileFlag = rawArgs[++i];
    } else if ((arg === '--format' || arg === '-f') && i + 1 < rawArgs.length) {
      formatFlag = rawArgs[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else {
      // Everything else is a gws arg — push the rest
      gwsArgs.push(...rawArgs.slice(i));
      break;
    }

    i++;
  }

  return { profileFlag, formatFlag, verbose, gwsArgs };
}

function handlePassthrough(rawArgs: string[]): void {
  const { profileFlag, formatFlag, verbose, gwsArgs } = parseGwcliArgs(rawArgs);

  if (gwsArgs.length === 0) {
    program.help();
    return;
  }

  try {
    const profile = resolveProfile(profileFlag);

    if (verbose) {
      process.stderr.write(`[gwcli] profile: ${profile.name}\n`);
      process.stderr.write(`[gwcli] gws config dir: ${profile.gwsConfigDir}\n`);
      process.stderr.write(`[gwcli] gws args: ${gwsArgs.join(' ')}\n`);
    }

    // Try compat translation for v1 command syntax
    const translated = tryTranslateCompat(gwsArgs);
    const effectiveArgs = translated ?? gwsArgs;

    // Pre-flight: Keep API is gated to Workspace accounts. Warn (don't block)
    // when a `keep ...` call goes through a consumer @gmail.com profile so the
    // user gets a clear hint before reading a raw `403 PERMISSION_DENIED`
    // from gws. See references/keep.md (Issue 8).
    if (effectiveArgs[0] === 'keep') {
      const email = profile.meta?.email;
      if (email && email.toLowerCase().endsWith('@gmail.com')) {
        process.stderr.write(
          `⚠ Profile '${profile.name}' is a consumer @gmail.com account. ` +
          `The Google Keep API is gated to Workspace accounts and will ` +
          `return 403 on every request. See references/keep.md.\n`
        );
      }
    }

    // Inject --format into gws args if specified by gwcli and not already in gws args
    const finalGwsArgs = [...effectiveArgs];
    if (formatFlag && !effectiveArgs.some(a => a === '--format' || a === '-f' || a.startsWith('--format=') || a.startsWith('-f='))) {
      finalGwsArgs.push('--format', formatFlag);
    }

    execGwsPassthrough(profile.name, finalGwsArgs);
  } catch (err) {
    if (err instanceof GwcliError) {
      process.stderr.write(`Error: ${err.message}\n`);
      if (err.suggestion) {
        process.stderr.write(`${err.suggestion}\n`);
      }
      process.exit(1);
    }
    throw err;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Help/version flags are gwcli-native — route them to Commander, not gws.
const TOP_LEVEL_HELP_FLAGS = new Set(['-h', '--help', '-V', '--version']);
const rawArgvSlice = process.argv.slice(2);
const wantsTopLevelHelp =
  rawArgvSlice.length > 0 && rawArgvSlice.every(a => TOP_LEVEL_HELP_FLAGS.has(a));

// Check if the first non-flag arg is a native command
const firstNonFlagArg = (() => {
  const args = rawArgvSlice;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === '--') break;
    if ((a === '-p' || a === '--profile' || a === '-f' || a === '--format') && i + 1 < args.length) {
      i += 2; // skip flag + value
      continue;
    }
    if (a === '-v' || a === '--verbose') {
      i++;
      continue;
    }
    if (!a.startsWith('-')) return a;
    break; // unknown flag — treat as gws arg
  }
  return undefined;
})();

const isNativeCommand =
  wantsTopLevelHelp || (firstNonFlagArg ? NATIVE_COMMANDS.has(firstNonFlagArg) : false);

if (isNativeCommand) {
  // Let Commander handle native commands normally
  program.parseAsync(process.argv).catch((error) => {
    if (error instanceof GwcliError) {
      process.stderr.write(`Error: ${error.message}\n`);
      if (error.suggestion) {
        process.stderr.write(`${error.suggestion}\n`);
      }
    } else {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  });
} else {
  // Passthrough mode — bypass Commander entirely for gws commands
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    program.parseAsync(process.argv); // shows help
  } else {
    handlePassthrough(rawArgs);
  }
}
