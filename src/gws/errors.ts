/**
 * Translate gws exit codes to user-friendly messages.
 * Based on Phase 0 observations of gws v0.22.5:
 *   0 = success
 *   2 = auth error (no credentials, expired, etc.)
 *   1 = general error (validation, network, API error)
 */
export function translateGwsError(exitCode: number): string | null {
  switch (exitCode) {
    case 0:
      return null;
    case 2:
      return 'Authentication error. Run: gwcli profiles auth <profile-name>';
    case 1:
      return null; // gws already printed the error to stderr
    default:
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
