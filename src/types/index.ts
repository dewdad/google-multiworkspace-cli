// ─── Global Config ───────────────────────────────────────────────────────────

export interface GlobalConfig {
  version: 1;
  defaultProfile: string | null;
  gwsBinary: string;
  settings: {
    defaultFormat: OutputFormat;
    annotateProfile: boolean;
  };
}

// ─── Profile Metadata ────────────────────────────────────────────────────────

export interface ProfileMeta {
  name: string;
  displayName: string;
  email: string | null;
  createdAt: string;
  lastUsed: string | null;
  scopes: string[];
  clientSecretSource: string;
  tags: string[];
}

// ─── CLI Types ───────────────────────────────────────────────────────────────

export type OutputFormat = 'json' | 'table' | 'yaml' | 'csv';

export interface GlobalOptions {
  profile?: string;
  format?: OutputFormat;
  verbose?: boolean;
  dryRun?: boolean;
}

// ─── GWS Runner Types ────────────────────────────────────────────────────────

export interface GwsRunResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface GwsBinaryInfo {
  path: string;
  version: string;
}

// ─── Profile Resolution ──────────────────────────────────────────────────────

export interface ResolvedProfile {
  name: string;
  gwsConfigDir: string;
  meta: ProfileMeta;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export class GwcliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'GwcliError';
  }
}

// ─── Doctor Types ────────────────────────────────────────────────────────────

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  suggestion?: string;
}
