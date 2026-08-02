import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MgwsError } from '../types/index.js';

// Mock the dependencies BEFORE importing the SUT
vi.mock('../gws/binary.js', () => ({
  findGwsBinary: vi.fn(),
}));
vi.mock('../profiles/config.js', () => ({
  listProfileNames: vi.fn(),
}));

const { findGwsBinary } = await import('../gws/binary.js');
const { listProfileNames } = await import('../profiles/config.js');
const { runPreflight, PREFLIGHT_EXIT } = await import('./preflight.js');

describe('runPreflight', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // process.exit must throw to halt execution after the call (matches real exit semantics
    // for testing — anything after process.exit shouldn't run).
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}__`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('exits READY (0) when gws is found and at least one profile exists', async () => {
    vi.mocked(findGwsBinary).mockReturnValue({ path: 'gws', version: '0.22.0' });
    vi.mocked(listProfileNames).mockReturnValue(['personal']);

    await expect(runPreflight()).rejects.toThrow('__exit_0__');
    expect(exitSpy).toHaveBeenCalledWith(PREFLIGHT_EXIT.READY);
  });

  it('exits GWS_MISSING (63) when gws binary cannot be found', async () => {
    vi.mocked(findGwsBinary).mockImplementation(() => {
      throw new MgwsError('Cannot find gws binary', 'GWS_NOT_FOUND', 'install it');
    });
    vi.mocked(listProfileNames).mockReturnValue(['personal']);

    await expect(runPreflight()).rejects.toThrow('__exit_63__');
    expect(exitSpy).toHaveBeenCalledWith(PREFLIGHT_EXIT.GWS_MISSING);
  });

  it('exits NO_PROFILES (64) when gws is found but no profiles exist', async () => {
    vi.mocked(findGwsBinary).mockReturnValue({ path: 'gws', version: '0.22.0' });
    vi.mocked(listProfileNames).mockReturnValue([]);

    await expect(runPreflight()).rejects.toThrow('__exit_64__');
    expect(exitSpy).toHaveBeenCalledWith(PREFLIGHT_EXIT.NO_PROFILES);
  });

  it('is silent on stderr by default (no --json)', async () => {
    vi.mocked(findGwsBinary).mockReturnValue({ path: 'gws', version: '0.22.0' });
    vi.mocked(listProfileNames).mockReturnValue([]);

    await expect(runPreflight()).rejects.toThrow('__exit_64__');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits JSON to stderr when --json is set, on failure', async () => {
    vi.mocked(findGwsBinary).mockReturnValue({ path: 'gws', version: '0.22.0' });
    vi.mocked(listProfileNames).mockReturnValue([]);

    await expect(runPreflight({ json: true })).rejects.toThrow('__exit_64__');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0]![0]).trim());
    expect(payload).toEqual({
      ok: false,
      error: 'no_profiles',
      fix: 'mgws init <name>',
    });
  });

  it('emits JSON ready payload to stderr when --json is set, on success', async () => {
    vi.mocked(findGwsBinary).mockReturnValue({ path: 'gws', version: '0.22.0' });
    vi.mocked(listProfileNames).mockReturnValue(['a', 'b', 'c']);

    await expect(runPreflight({ json: true })).rejects.toThrow('__exit_0__');
    const payload = JSON.parse(String(stderrSpy.mock.calls[0]![0]).trim());
    expect(payload).toEqual({ ok: true, profileCount: 3 });
  });

  it('emits gws_missing payload with code from MgwsError when --json is set', async () => {
    vi.mocked(findGwsBinary).mockImplementation(() => {
      throw new MgwsError('not found', 'GWS_NOT_FOUND', 'install');
    });

    await expect(runPreflight({ json: true })).rejects.toThrow('__exit_63__');
    const payload = JSON.parse(String(stderrSpy.mock.calls[0]![0]).trim());
    expect(payload).toMatchObject({
      ok: false,
      error: 'gws_missing',
      code: 'GWS_NOT_FOUND',
    });
  });

  it('rethrows non-MgwsError exceptions from findGwsBinary', async () => {
    const surprise = new Error('unexpected');
    vi.mocked(findGwsBinary).mockImplementation(() => {
      throw surprise;
    });

    await expect(runPreflight()).rejects.toBe(surprise);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
