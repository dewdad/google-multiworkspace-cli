import { Command } from 'commander';
import { addProfile, removeProfile, listAllProfiles, renameProfile, setDefaultProfile, refreshProfileEmail } from '../profiles/index.js';
import { getProfileMeta } from '../profiles/config.js';
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
            // Best-effort: resolve and persist the bound Google identity.
            try {
              const email = refreshProfileEmail(name);
              if (email) {
                console.log(`Identity: ${email}`);
              }
            } catch {
              // Non-fatal — auth succeeded.
            }
          } else {
            // Auth failed AFTER scaffolding — roll back to avoid leaving an
            // orphaned profile directory that blocks retries with the same
            // name (Issue 3).
            console.error(`Authentication failed. Rolling back profile '${name}'.`);
            try {
              removeProfile(name);
            } catch {
              // Last-ditch: leave breadcrumbs so the user can clean up manually.
              console.error(`(Could not auto-remove. Run: gwcli profiles remove ${name} --force)`);
            }
            console.error(`Re-run: gwcli profiles add ${name} --client <path>`);
            process.exit(result.exitCode || 1);
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
    .option('--scopes <list>', 'Comma-separated service names (defaults to the profile\'s stored scopes)')
    .action((name: string, options) => {
      try {
        findGwsBinary();

        // Resolve scopes: explicit --scopes wins, else fall back to the
        // profile's stored scopes. This bypasses the gws interactive scope
        // picker (which hangs in non-TTY environments — CI, agent spawns, etc.).
        let scopes: string[] | undefined = options.scopes
          ?.split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);

        if (!scopes || scopes.length === 0) {
          const meta = getProfileMeta(name);
          if (meta && meta.scopes && meta.scopes.length > 0) {
            scopes = meta.scopes;
          }
        }

        // Non-TTY guard: if we still have no scopes AND stdin isn't a TTY,
        // gws will render an interactive picker and hang forever. Refuse early
        // with a clear remediation hint instead of silently deadlocking.
        if ((!scopes || scopes.length === 0) && !process.stdin.isTTY) {
          throw new GwcliError(
            `Cannot authenticate profile '${name}' in a non-interactive environment without explicit scopes.`,
            'AUTH_NEEDS_SCOPES_NON_TTY',
            `Re-run with --scopes, e.g.:\n  gwcli profiles auth ${name} --scopes gmail,calendar,drive,docs,sheets,tasks`
          );
        }

        console.log(`Authenticating profile '${name}'...`);
        if (scopes && scopes.length > 0) {
          console.log(`Using scopes: ${scopes.join(', ')}`);
        }
        const result = runGwsAuthLogin(name, scopes);
        if (result.exitCode === 0) {
          console.log(`Profile '${name}' authenticated successfully.`);
          // Best-effort: persist the resolved Google identity so `profiles list`
          // / `profiles status` show a real email instead of `null`.
          try {
            const email = refreshProfileEmail(name);
            if (email) {
              console.log(`Identity: ${email}`);
            }
          } catch {
            // Non-fatal: auth succeeded, email backfill is a nice-to-have.
          }
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
          // Single-profile status: unified shape — same per-profile keys as
          // `profiles list`, plus an optional `details` slot for the raw gws
          // auth status (paths, auth_method, etc.).
          const allEntries = listAllProfiles({ backfillEmail: true });
          const entry = allEntries.find(e => e.name === name);
          const { exitCode, status } = runGwsAuthStatus(name);

          if (entry) {
            const unified = {
              name: entry.name,
              displayName: entry.displayName,
              email: entry.email,
              isDefault: entry.isDefault,
              authenticated: entry.authenticated,
              scopes: entry.scopes,
              lastUsed: entry.lastUsed,
              ...(status ? { details: status } : {}),
            };
            if (wantJson) {
              console.log(JSON.stringify(unified, null, 2));
            } else {
              console.log(JSON.stringify(unified, null, 2));
            }
          } else if (status) {
            // Profile dir is gone but gws still has state — surface raw gws output.
            console.log(JSON.stringify({ name, details: status }, null, 2));
          }
          if (exitCode !== 0) {
            process.exit(exitCode);
          }
          return;
        }

        // Bulk mode: status for all profiles. Returns the same array shape
        // that `profiles list --format json` produces, so jq queries are
        // portable between the two commands.
        const entries = listAllProfiles({ backfillEmail: true });
        const anyUnauthenticated = entries.some(e => !e.authenticated);

        if (wantJson) {
          console.log(JSON.stringify(entries, null, 2));
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
