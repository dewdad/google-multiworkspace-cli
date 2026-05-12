#!/usr/bin/env node

import { Command } from 'commander';
import { registerProfilesCommands } from './commands/profiles.js';
import { resolveProfile } from './profiles/resolver.js';
import { execGwsPassthrough } from './gws/runner.js';
import { findGwsBinary } from './gws/binary.js';
import { runDoctor } from './commands/doctor.js';
import { runMigrate } from './commands/migrate.js';
import { tryTranslateCompat } from './compat/translations.js';
import { GwcliError } from './types/index.js';

const program = new Command();

program
  .name('gwcli')
  .description('Multi-profile Google Workspace CLI — orchestration layer over gws')
  .version('2.0.0')
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
    console.log(`gwcli  2.0.0`);
    console.log(`gws    ${gwsInfo.version}  (${gwsInfo.path})`);
  });

// ─── Passthrough: Everything else goes to gws ────────────────────────────────

// ─── Arg Parser (extract gwcli flags, leave rest for gws) ────────────────────

interface ParsedArgs {
  profileFlag?: string;
  formatFlag?: string;
  verbose: boolean;
  gwsArgs: string[];
}

const NATIVE_COMMANDS = new Set(['profiles', 'doctor', 'version-info', 'migrate', 'help']);

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

    // Inject --format into gws args if specified by gwcli and not already in gws args
    const finalGwsArgs = [...effectiveArgs];
    if (formatFlag && !effectiveArgs.includes('--format') && !effectiveArgs.includes('-f')) {
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

// Check if the first non-flag arg is a native command
const firstNonFlagArg = (() => {
  const args = process.argv.slice(2);
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

const isNativeCommand = firstNonFlagArg && NATIVE_COMMANDS.has(firstNonFlagArg);

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
