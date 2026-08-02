import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock setup so runInit's gws-install pre-check is deterministic and offline.
vi.mock('./setup.js', () => ({
  ensureSetup: vi.fn(),
}));

const { ensureSetup } = await import('./setup.js');
const { runInit } = await import('./init.js');

describe('runInit — gws bootstrap + name resolution', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}__`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('exits 1 when gws setup fails', async () => {
    vi.mocked(ensureSetup).mockReturnValue({
      success: false,
      steps: [{ name: 'install gws', status: 'error', detail: 'network down' }],
    });

    await expect(runInit(undefined, {})).rejects.toThrow('__exit_1__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('throws INIT_NEEDS_NAME in a non-interactive environment without a name', async () => {
    vi.mocked(ensureSetup).mockReturnValue({ success: true, steps: [] });

    // In vitest, process.stdin.isTTY is undefined → non-interactive.
    let thrown: unknown;
    try {
      await runInit(undefined, {});
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string }).code).toBe('INIT_NEEDS_NAME');
  });
});
