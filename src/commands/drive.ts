import { Command } from 'commander';
import { DriveClient } from '../lib/drive-client.js';
import { getAuthenticatedClient } from '../lib/auth.js';
import { getActiveProfile } from '../lib/config.js';
import { formatFileList, print, printSuccess, printError } from '../lib/output.js';
import type { GlobalOptions } from '../types/index.js';

interface DriveListOptions extends GlobalOptions {
  folder?: string;
  limit?: string;
}

interface DriveSearchOptions extends GlobalOptions {
  limit?: string;
}

interface DriveDownloadOptions extends GlobalOptions {
  output?: string;
}

/**
 * Register all Drive subcommands
 */
export function registerDriveCommands(program: Command): void {
  const drive = program
    .command('drive')
    .description('Manage Google Drive files (read-only)')
    .enablePositionalOptions()
    .passThroughOptions();

  // drive list
  drive
    .command('list')
    .description('List files/folders from Google Drive')
    .option('--folder <id>', 'List files in a specific folder')
    .option('--limit <n>', 'Maximum number of files to list', '100')
    .action(async (options: DriveListOptions) => {
      try {
        const globalOptions = program.opts<GlobalOptions>();
        const profileName = getActiveProfile(globalOptions.profile || options.profile);
        const auth = await getAuthenticatedClient(profileName);
        const client = new DriveClient(auth);

        const limit = parseInt(options.limit || '100');
        const files = await client.list({
          folderId: options.folder,
          maxResults: limit,
        });

        const format = globalOptions.format || options.format || 'table';
        const output = formatFileList(files, format);
        print(output);
      } catch (error) {
        printError('Error listing files: ' + (error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // drive search
  drive
    .command('search <query>')
    .description('Search files with Drive query syntax')
    .option('--limit <n>', 'Maximum number of results', '100')
    .action(async (query: string, options: DriveSearchOptions) => {
      try {
        const globalOptions = program.opts<GlobalOptions>();
        const profileName = getActiveProfile(globalOptions.profile || options.profile);
        const auth = await getAuthenticatedClient(profileName);
        const client = new DriveClient(auth);

        const limit = parseInt(options.limit || '100');
        const files = await client.search(query, limit);

        const format = globalOptions.format || options.format || 'table';
        const output = formatFileList(files, format);
        print(output);
      } catch (error) {
        printError('Error searching files: ' + (error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // drive download
  drive
    .command('download <file-id>')
    .description('Download a file from Google Drive')
    .option('--output <path>', 'Output file path (defaults to file name in current directory)')
    .action(async (fileId: string, options: DriveDownloadOptions) => {
      try {
        const globalOptions = program.opts<GlobalOptions>();
        const profileName = getActiveProfile(globalOptions.profile || options.profile);
        const auth = await getAuthenticatedClient(profileName);
        const client = new DriveClient(auth);

        // Get file metadata to determine output path if not specified
        let outputPath = options.output;
        if (!outputPath) {
          const metadata = await client.getFileMetadata(fileId);
          outputPath = metadata.name;
        }

        await client.download(fileId, outputPath);
        printSuccess(`Downloaded to: ${outputPath}`);
      } catch (error) {
        printError('Error downloading file: ' + (error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // drive export
  drive
    .command('export <file-id>')
    .description('Export Google Doc/Sheet/Slide to specified format')
    .requiredOption('--format <fmt>', 'Export format: pdf, docx, txt, md, html, xlsx, csv, pptx')
    .option('--output <path>', 'Output file path (defaults to file name with format extension)')
    .action(async (fileId: string, options: { format: string; output?: string }) => {
      try {
        const globalOptions = program.opts<GlobalOptions>();
        const profileName = getActiveProfile(globalOptions.profile);
        const auth = await getAuthenticatedClient(profileName);
        const client = new DriveClient(auth);

        // Get file metadata to determine output path if not specified
        let outputPath = options.output;
        if (!outputPath) {
          const metadata = await client.getFileMetadata(fileId);
          // Remove existing extension and add the export format extension
          const baseName = metadata.name.replace(/\.[^/.]+$/, '');
          outputPath = `${baseName}.${options.format}`;
        }

        await client.export(fileId, options.format, outputPath);
        printSuccess(`Exported to: ${outputPath}`);
      } catch (error) {
        printError('Error exporting file: ' + (error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}
