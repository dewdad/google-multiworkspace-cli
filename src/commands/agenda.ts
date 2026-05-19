import { resolveProfile } from '../profiles/resolver.js';
import { runGws } from '../gws/runner.js';
import { GwcliError } from '../types/index.js';

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
    throw new GwcliError(
      `Invalid --days value: ${options.days}`,
      'INVALID_AGENDA_DAYS',
      'Use a positive integer like --days 7'
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

  // Reduce response payload to the fields agents actually use for "what's on my calendar".
  args.push(
    '--fields',
    'items(id,summary,start,end,location,attendees(email,responseStatus),htmlLink)'
  );

  if (options.formatFlag) {
    args.push('--format', options.formatFlag);
  }

  const { exitCode } = runGws({ profileName: profile.name, args });
  process.exit(exitCode);
}
