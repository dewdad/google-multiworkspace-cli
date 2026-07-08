import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIG_ID = process.env['GWCLI_CLIENT_ID'];
const ORIG_SECRET = process.env['GWCLI_CLIENT_SECRET'];

afterEach(() => {
  if (ORIG_ID === undefined) delete process.env['GWCLI_CLIENT_ID'];
  else process.env['GWCLI_CLIENT_ID'] = ORIG_ID;
  if (ORIG_SECRET === undefined) delete process.env['GWCLI_CLIENT_SECRET'];
  else process.env['GWCLI_CLIENT_SECRET'] = ORIG_SECRET;
  vi.resetModules();
});

describe('default OAuth client constants', () => {
  it('ships non-empty built-in defaults when no override env is set', async () => {
    delete process.env['GWCLI_CLIENT_ID'];
    delete process.env['GWCLI_CLIENT_SECRET'];
    vi.resetModules();

    const { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } = await import('./default-client.js');

    expect(DEFAULT_OAUTH_CLIENT_ID).toBeTruthy();
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toBeTruthy();
    expect(DEFAULT_OAUTH_CLIENT_ID).toContain('.apps.googleusercontent.com');
  });

  it('lets GWCLI_CLIENT_ID / GWCLI_CLIENT_SECRET override the built-in defaults', async () => {
    process.env['GWCLI_CLIENT_ID'] = 'override-id.apps.googleusercontent.com';
    process.env['GWCLI_CLIENT_SECRET'] = 'override-secret';
    vi.resetModules();

    const { DEFAULT_OAUTH_CLIENT_ID, DEFAULT_OAUTH_CLIENT_SECRET } = await import('./default-client.js');

    expect(DEFAULT_OAUTH_CLIENT_ID).toBe('override-id.apps.googleusercontent.com');
    expect(DEFAULT_OAUTH_CLIENT_SECRET).toBe('override-secret');
  });
});
