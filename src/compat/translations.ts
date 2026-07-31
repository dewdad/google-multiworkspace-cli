/**
 * Backward-compatibility translation layer.
 *
 * Translates old gwcli v1 command syntax to equivalent gws commands.
 * Logs a deprecation warning when a translation is applied.
 *
 * Remove after 3 months or in v3.0.
 */

interface Translation {
  /** gws args to use instead */
  translate: (args: string[]) => string[];
  /** Deprecation message */
  newSyntax: string;
  /**
   * True when the v1 command takes a positional argument at position 3+.
   * Suppresses the native-gws-method pass-through guard for this entry.
   */
  takesPositionalArg?: true;
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

const TRANSLATIONS: Record<string, Translation> = {
  'gmail list': {
    translate: (args) => {
      const limit = extractFlag(args, '--limit') ?? '20';
      const q = hasFlag(args, '--unread') ? 'is:unread' : '';
      const params: Record<string, unknown> = { userId: 'me', maxResults: Number(limit) };
      if (q) params['q'] = q;
      return [
        'gmail', 'users', 'messages', 'list',
        '--params', JSON.stringify(params),
        '--fields', 'messages(id,threadId,snippet,labelIds,internalDate)',
      ];
    },
    newSyntax: "gwcli gmail users messages list --params '{\"userId\":\"me\"}'",
  },

  'gmail read': {
    translate: (args) => {
      const id = args.find(a => !a.startsWith('-'));
      const params: Record<string, unknown> = { userId: 'me', id: id ?? '' };
      return [
        'gmail', 'users', 'messages', 'get',
        '--params', JSON.stringify(params),
      ];
    },
    newSyntax: "gwcli gmail users messages get --params '{\"userId\":\"me\",\"id\":\"<id>\"}'",
  },

  'calendar events': {
    translate: (args) => {
      const days = extractFlag(args, '--days') ?? '7';
      return ['calendar', '+agenda', '--days', days];
    },
    newSyntax: 'gwcli calendar +agenda --days 7',
  },

  'calendar list': {
    translate: () => {
      return ['calendar', 'calendarList', 'list', '--params', '{}'];
    },
    newSyntax: "gwcli calendar calendarList list --params '{}'",
  },

  'drive list': {
    translate: (args) => {
      const limit = extractFlag(args, '--limit') ?? '20';
      return [
        'drive', 'files', 'list',
        '--params', JSON.stringify({ pageSize: Number(limit) }),
        '--fields', 'files(id,name,mimeType,modifiedTime)',
      ];
    },
    newSyntax: "gwcli drive files list --params '{\"pageSize\":20}'",
  },

  'drive search': {
    takesPositionalArg: true,
    translate: (args) => {
      const query = args.find(a => !a.startsWith('-')) ?? '';
      const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return [
        'drive', 'files', 'list',
        '--params', JSON.stringify({ q: `name contains '${escaped}'`, pageSize: 20 }),
        '--fields', 'files(id,name,mimeType,modifiedTime)',
      ];
    },
    newSyntax: "gwcli drive files list --params '{\"q\":\"name contains term\",\"pageSize\":20}'",
  },
};

/**
 * Check if args match a deprecated v1 command pattern and translate if so.
 * Returns null if no translation applies (pass through to gws as-is).
 *
 * Disambiguation: a v1 two-word command ("calendar events") collides with the
 * native three-word gws form ("calendar events list/get/insert/..."). To avoid
 * spuriously deprecating valid native calls, we only translate when the third
 * positional arg is missing or is a flag (starts with '-'). A non-flag third
 * arg means the user typed a real gws method — pass through untouched.
 */
export function tryTranslateCompat(gwsArgs: string[]): string[] | null {
  if (gwsArgs.length < 2) return null;

  const key = `${gwsArgs[0]} ${gwsArgs[1]}`;
  const translation = TRANSLATIONS[key];

  if (!translation) return null;

  const third = gwsArgs[2];
  if (third !== undefined && !third.startsWith('-') && !translation.takesPositionalArg) {
    // User supplied a real third positional (e.g. "list", "get") — this is
    // native gws syntax, not the deprecated v1 alias. Pass through.
    // Exception: translations that take a positional query arg (e.g. 'drive search').
    return null;
  }

  // Remaining args after the two-word command
  const remainingArgs = gwsArgs.slice(2);
  const translated = translation.translate(remainingArgs);

  // Emit deprecation warning
  process.stderr.write(
    `⚠ Deprecated syntax: 'gwcli ${key}' → use native gws syntax.\n` +
    `  New: ${translation.newSyntax}\n\n`
  );

  return translated;
}
