import { resolveProfile } from '../profiles/resolver.js';
import { runGws } from '../gws/runner.js';
import { MgwsError } from '../types/index.js';

export interface AgendaOptions {
  profileFlag?: string;
  formatFlag?: string;
  days: number;
  calendarId: string;
  maxResults: number;
}

/**
 * Native implementation of "show my agenda".
 *
 * Composes a calendar.events.list call with a [now, now+days] time window.
 * Implemented natively (not as a passthrough) so it works regardless of
 * whether the underlying gws build supports a `+agenda` shortcut.
 */
export function runAgenda(options: AgendaOptions): never {
  if (!Number.isFinite(options.days) || options.days <= 0) {
    throw new MgwsError(
      `Invalid --days value: ${options.days}`,
      'INVALID_AGENDA_DAYS',
      'Use a positive integer like --days 7'
    );
  }

  if (!Number.isFinite(options.maxResults) || options.maxResults <= 0) {
    throw new MgwsError(
      `Invalid --max value: ${options.maxResults}`,
      'INVALID_AGENDA_MAX',
      'Use a positive integer like --max 50'
    );
  }

  const now = new Date();
  const end = new Date(now.getTime() + options.days * 24 * 60 * 60 * 1000);

  const params = {
    calendarId: options.calendarId,
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: options.maxResults,
  };

  const profile = resolveProfile(options.profileFlag);

  const args = [
    'calendar',
    'events',
    'list',
    '--params',
    JSON.stringify(params),
  ];

  // NOTE: gws 0.22.x removed the `--fields` response mask; field filtering is
  // expected to happen client-side. We forward the full response and let the
  // caller (agent or human) trim. Re-introduce a mask only after confirming
  // the flag exists in the active gws version (`gws calendar events list --help`).

  if (options.formatFlag) {
    args.push('--format', options.formatFlag);
  }

  const { exitCode } = runGws({ profileName: profile.name, args });
  process.exit(exitCode);
}
