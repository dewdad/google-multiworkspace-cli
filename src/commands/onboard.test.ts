import { describe, it, expect, vi } from 'vitest';
import { resolveScopeList, resolveClientForScopeCap, emitJsonError } from './onboard.js';
import { DEFAULT_SERVICES, FULL_ACCESS_SENTINEL } from '../profiles/scopes.js';
import { MgwsError } from '../types/index.js';

describe('resolveScopeList', () => {
  it('defaults to DEFAULT_SERVICES when no scopes or full flag given', () => {
    const result = resolveScopeList({});
    expect(result.fullAccess).toBe(false);
    expect(result.scopes).toEqual([...DEFAULT_SERVICES]);
  });

  it('parses a comma list, trimming whitespace and dropping empties', () => {
    const result = resolveScopeList({ scopes: ' gmail , calendar ,, drive ' });
    expect(result).toEqual({ scopes: ['gmail', 'calendar', 'drive'], fullAccess: false });
  });

  it('returns the full-access sentinel when full is true, ignoring scopes', () => {
    const result = resolveScopeList({ full: true, scopes: 'gmail,calendar' });
    expect(result).toEqual({ scopes: [FULL_ACCESS_SENTINEL], fullAccess: true });
  });
});

describe('resolveClientForScopeCap', () => {
  const base = {
    auth: true,
    clientSecretPath: undefined as string | undefined,
    scopes: [...DEFAULT_SERVICES],
    fullAccess: false,
  };
  const neverPrompt = async (): Promise<string | null> => {
    throw new Error('prompt should not be called');
  };

  it('returns undefined without prompting for a within-cap default set', async () => {
    const result = await resolveClientForScopeCap('p', base, neverPrompt, undefined);
    expect(result).toBeUndefined();
  });

  it('skips the gate when a custom client is already supplied', async () => {
    const result = await resolveClientForScopeCap(
      'p',
      { ...base, fullAccess: true, clientSecretPath: '/tmp/custom.json' },
      neverPrompt,
      undefined
    );
    expect(result).toBe('/tmp/custom.json');
  });

  it('skips the gate when auth is disabled', async () => {
    const result = await resolveClientForScopeCap(
      'p',
      { ...base, fullAccess: true, auth: false },
      neverPrompt,
      undefined
    );
    expect(result).toBeUndefined();
  });

  it('skips the gate when MGWS_CLIENT_ID overrides the built-in client', async () => {
    const result = await resolveClientForScopeCap(
      'p',
      { ...base, fullAccess: true },
      neverPrompt,
      'org-client-id'
    );
    expect(result).toBeUndefined();
  });

  it('prompts and returns the chosen client when the request exceeds the cap', async () => {
    const result = await resolveClientForScopeCap(
      'p',
      { ...base, scopes: [...DEFAULT_SERVICES, 'classroom'] },
      async () => '/tmp/internal.json',
      undefined
    );
    expect(result).toBe('/tmp/internal.json');
  });

  it('throws SCOPE_CAP_EXCEEDED when the prompt is cancelled', async () => {
    await expect(
      resolveClientForScopeCap('p', { ...base, fullAccess: true }, async () => null, undefined)
    ).rejects.toMatchObject({ code: 'SCOPE_CAP_EXCEEDED' });
  });
});

describe('emitJsonError', () => {
  it('writes a stable machine-readable error object to stdout', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    });
    try {
      emitJsonError(
        new MgwsError('scopes exceed the cap', 'SCOPE_CAP_EXCEEDED', 'pass --client or narrow --scopes')
      );
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      success: false,
      error: 'SCOPE_CAP_EXCEEDED',
      message: 'scopes exceed the cap',
      suggestion: 'pass --client or narrow --scopes',
    });
  });

  it('omits suggestion when the error has none', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    });
    try {
      emitJsonError(new MgwsError('boom', 'AUTH_FAILED'));
    } finally {
      spy.mockRestore();
    }
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({ success: false, error: 'AUTH_FAILED', message: 'boom' });
    expect(parsed).not.toHaveProperty('suggestion');
  });
});
