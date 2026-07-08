// ─── Built-in Desktop OAuth client ───────────────────────────────────────────
//
// gwcli ships a default Desktop-type OAuth client so `gwcli profiles add <name>`
// "just logs in" without the user having to create their own Cloud-Console
// client first (the gcloud / gh model).
//
// Why shipping the secret is safe: Google classifies **Desktop / installed-app**
// client secrets as NON-confidential. The installed-app OAuth flow assumes the
// secret is embedded in distributed code and cannot be kept private (see
// RFC 8252 and Google's OAuth docs). gcloud, gh, and the AWS SAM CLI all embed
// their client secret the same way. So committing these to source is the
// intended, sanctioned pattern — not a credential leak.
//
// The defaults are overridable at runtime via `GWCLI_CLIENT_ID` /
// `GWCLI_CLIENT_SECRET` so the shipped client can be rotated (or replaced with
// an org-specific one) without a rebuild.
export const DEFAULT_OAUTH_CLIENT_ID =
  process.env['GWCLI_CLIENT_ID'] ??
  '446192415694-qii4n0omi544khef2760l1v560m167lm.apps.googleusercontent.com';

export const DEFAULT_OAUTH_CLIENT_SECRET =
  process.env['GWCLI_CLIENT_SECRET'] ?? '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';
