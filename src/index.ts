#!/usr/bin/env node

import { Command } from 'commander';
import { registerProfilesCommands } from './commands/profiles.js';
import { registerGmailCommands } from './commands/gmail.js';
import { registerCalendarCommands } from './commands/calendar.js';
import { registerDriveCommands } from './commands/drive.js';

const program = new Command();

program
  .name('gwcli')
  .description('Google Workspace CLI - Manage Gmail, Calendar, and Drive with multi-profile support')
  .version('0.1.0')
  .enablePositionalOptions()
  .option('-p, --profile <name>', 'Use a specific profile (overrides GWCLI_PROFILE and default)')
  .option('-f, --format <type>', 'Output format: json, table, text', 'table');

// Register command groups
registerProfilesCommands(program);
registerGmailCommands(program);
registerCalendarCommands(program);
registerDriveCommands(program);

// Parse and execute
program.parseAsync(process.argv).catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
