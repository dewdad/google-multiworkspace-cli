import { Command } from 'commander';
import { addProfile, removeProfile, listAllProfiles, renameProfile, setDefaultProfile } from '../profiles/index.js';
import { runGwsAuthLogin, runGwsAuthStatus } from '../gws/runner.js';
import { findGwsBinary } from '../gws/binary.js';
import { formatOutput } from '../lib/output.js';
import { GwcliError } from '../types/index.js';

export function registerProfilesCommands(program: Command): void {
  const profiles = program
    .command('profiles')
    .description('Manage authentication profiles');

  // ─── profiles list ───────────────────────────────────────────────────────

  profiles
    .command('list')
    .description('List all profiles. Defaults to JSON when piped, table when interactive.')
    .option('--format <fmt>', 'Output format: json, table (default: auto)')
    .action((options) => {
      const entries = listAllProfiles();
      // Format resolution:
      //   1. explicit --format on the subcommand
      //   2. global --format on gwcli
      //   3. auto: JSON if not TTY (piped/captured), table if interactive
      const format =
        options.format ??
        program.opts().format ??
        (process.stdout.isTTY ? 'table' : 'json');

      if (entries.length === 0) {
        if (format === 'json') {
          console.log('[]');
        } else {
          console.log('No profiles configured.');
          console.log('Add a profile with: gwcli profiles add <name> --client <path>');
        }
        return;
      }

      if (format === 'json') {
        console.log(JSON.stringify(entries, null, 2));
      } else {
        const tableData = entries.map(e => ({
          name: `${e.isDefault ? '* ' : '  '}${e.name}`,
          email: e.email ?? '(not authenticated)',
          scopes: e.scopes.join(', '),
          authenticated: e.authenticated ? 'yes' : 'no',
        }));
        console.log(formatOutput(tableData, 'table'));
      }
    });

  // ─── profiles add ────────────────────────────────────────────────────────

  profiles
    .command('add <name>')
    .description('Add a new profile')
    .requiredOption('--client <path>', 'Path to OAuth client credentials JSON file')
    .option('--scopes <list>', 'Comma-separated service names for scope picker', 'gmail,calendar,drive,docs,sheets,keep,tasks')
    .option('--display-name <name>', 'Human-friendly display name')
    .option('--no-auth', 'Skip authentication after creating profile')
    .action(async (name: string, options) => {
      try {
        // Verify gws is available
        findGwsBinary();

        const scopes = options.scopes.split(',').map((s: string) => s.trim());
        addProfile(name, {
          clientSecretPath: options.client,
          displayName: options.displayName,
          scopes,
        });

        console.log(`Profile '${name}' created.`);

        if (options.auth !== false) {
          console.log('Starting authentication...');
          const result = runGwsAuthLogin(name, scopes);
          if (result.exitCode === 0) {
            console.log(`Profile '${name}' authenticated successfully.`);
          } else {
            console.error(`Authentication failed. Run later: gwcli profiles auth ${name}`);
          }
        } else {
          console.log(`Skipping auth. Run later: gwcli profiles auth ${name}`);
        }
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ─── profiles remove ─────────────────────────────────────────────────────

  profiles
    .command('remove <name>')
    .description('Remove a profile and its credentials')
    .option('--force', 'Skip confirmation')
    .action((name: string, options) => {
      try {
        if (!options.force) {
          console.error(`This will permanently delete profile '${name}' and its credentials.`);
          console.error(`Re-run with --force to confirm: gwcli profiles remove ${name} --force`);
          process.exit(1);
        }

        removeProfile(name);
        console.log(`Profile '${name}' removed.`);
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ─── profiles rename ─────────────────────────────────────────────────────

  profiles
    .command('rename <old> <new>')
    .description('Rename a profile')
    .action((oldName: string, newName: string) => {
      try {
        renameProfile(oldName, newName);
        console.log(`Profile renamed: '${oldName}' → '${newName}'`);
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ─── profiles set-default ────────────────────────────────────────────────

  profiles
    .command('set-default <name>')
    .description('Set the default profile')
    .action((name: string) => {
      try {
        setDefaultProfile(name);
        console.log(`Default profile set to '${name}'.`);
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ─── profiles auth ───────────────────────────────────────────────────────

  profiles
    .command('auth <name>')
    .description('(Re-)authenticate a profile')
    .option('--scopes <list>', 'Comma-separated service names')
    .action((name: string, options) => {
      try {
        findGwsBinary();
        const scopes = options.scopes?.split(',').map((s: string) => s.trim());
        console.log(`Authenticating profile '${name}'...`);
        const result = runGwsAuthLogin(name, scopes);
        if (result.exitCode === 0) {
          console.log(`Profile '${name}' authenticated successfully.`);
        } else {
          console.error(`Authentication failed (exit code: ${result.exitCode}).`);
          process.exit(result.exitCode);
        }
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ─── profiles status ─────────────────────────────────────────────────────

  profiles
    .command('status [name]')
    .description('Check auth status of one profile or all profiles')
    .option('--format <fmt>', 'Output format: text (default), json')
    .option('--strict', 'Exit non-zero if any profile is not authenticated (bulk mode only)')
    .action((name: string | undefined, options) => {
      try {
        findGwsBinary();

        const explicitFormat = options.format ?? program.opts().format;
        const wantJson =
          explicitFormat === 'json' ||
          (!explicitFormat && !process.stdout.isTTY);

        if (name) {
          const { exitCode, status } = runGwsAuthStatus(name);
          if (status) {
            if (wantJson) {
              console.log(JSON.stringify({ profile: name, status }, null, 2));
            } else {
              console.log(JSON.stringify(status, null, 2));
            }
          }
          if (exitCode !== 0) {
            process.exit(exitCode);
          }
          return;
        }

        // Bulk mode: status for all profiles
        const entries = listAllProfiles();
        const anyUnauthenticated = entries.some(e => !e.authenticated);

        if (wantJson) {
          console.log(
            JSON.stringify(
              {
                profiles: entries.map(e => ({
                  name: e.name,
                  email: e.email,
                  authenticated: e.authenticated,
                  isDefault: e.isDefault,
                  scopes: e.scopes,
                })),
                allAuthenticated: !anyUnauthenticated,
                count: entries.length,
              },
              null,
              2
            )
          );
        } else {
          for (const entry of entries) {
            const marker = entry.isDefault ? '*' : ' ';
            const authStatus = entry.authenticated ? '✓' : '✗';
            console.log(`${marker} ${authStatus} ${entry.name.padEnd(20)} ${entry.email ?? '(no email)'}`);
          }
        }

        if (options.strict && anyUnauthenticated) {
          process.exit(2);
        }
      } catch (err) {
        if (err instanceof GwcliError) {
          console.error(`Error: ${err.message}`);
          if (err.suggestion) console.error(err.suggestion);
        } else {
          console.error('Error:', err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });
}
