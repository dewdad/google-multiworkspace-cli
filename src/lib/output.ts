import Table from 'cli-table3';
import chalk from 'chalk';
import type { OutputFormat } from '../types/index.js';

/**
 * Generic table/JSON formatter for gwcli-native command output.
 * gws passthrough output is NOT processed by this — it goes directly via stdio: 'inherit'.
 */
export function formatOutput(
  data: unknown,
  format: OutputFormat,
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'table':
      if (Array.isArray(data)) {
        if (data.length === 0) return 'No data to display.';
        const keys = Object.keys(data[0]);
        const table = new Table({
          head: keys.map((k) => chalk.cyan(k)),
        });
        data.forEach((item) => {
          table.push(keys.map((k) => String(item[k] ?? '')));
        });
        return table.toString();
      }
      return JSON.stringify(data, null, 2);
    case 'yaml':
      if (Array.isArray(data)) {
        return data.map(item => {
          return Object.entries(item as Record<string, unknown>)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n');
        }).join('\n---\n');
      }
      return Object.entries(data as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    case 'csv':
      if (Array.isArray(data) && data.length > 0) {
        const keys = Object.keys(data[0]);
        const header = keys.join(',');
        const rows = data.map(item =>
          keys.map(k => {
            const val = String((item as Record<string, unknown>)[k] ?? '');
            return val.includes(',') ? `"${val}"` : val;
          }).join(',')
        );
        return [header, ...rows].join('\n');
      }
      return JSON.stringify(data, null, 2);
    default:
      return JSON.stringify(data, null, 2);
  }
}
