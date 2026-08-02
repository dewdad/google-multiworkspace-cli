/**
 * Translate gws exit codes to user-friendly messages.
 *
 * gws owns its exit-code contract; mgws forwards the real code verbatim
 * (see execGwsPassthrough) and only adds a supplementary hint where it has
 * profile-level context gws lacks. gws already prints a descriptive error to
 * stderr for every non-zero code, so we stay silent for all of them except
 * auth (2), where we can point at the profile-scoped re-auth command.
 *
 * gws 0.22.5 exit-code table (`gws --help`):
 *   0 = success
 *   1 = API error   (Google returned an error response)
 *   2 = auth error  (credentials missing or invalid)
 *   3 = validation  (bad arguments or input)
 *   4 = discovery   (could not fetch API schema)
 *   5 = internal    (unexpected failure)
 */
export function translateGwsError(exitCode: number): string | null {
  switch (exitCode) {
    case 2:
      return 'Authentication error. Run: mgws profiles auth <profile-name>';
    default:
      // gws already printed a descriptive error to stderr — don't second-guess it.
      return null;
  }
}

/**
 * Parse a JSON error response from gws stdout (when captured).
 * Returns null if parsing fails or output isn't a gws error.
 */
export function parseGwsErrorJson(stdout: string): GwsErrorInfo | null {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed?.error?.code && parsed?.error?.message) {
      return {
        code: parsed.error.code,
        message: parsed.error.message,
        reason: parsed.error.reason ?? 'unknown',
      };
    }
  } catch {
    // Not JSON or not a gws error format
  }
  return null;
}

export interface GwsErrorInfo {
  code: number;
  message: string;
  reason: string;
}
