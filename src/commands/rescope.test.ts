import { describe, it, expect } from 'vitest';
import { computeRescope } from './rescope.js';
import { FULL_ACCESS_SENTINEL } from '../profiles/scopes.js';

describe('computeRescope', () => {
  it('short-circuits to the full-access sentinel when --full is set', () => {
    const result = computeRescope(['gmail', 'calendar'], { full: true });
    expect(result).toEqual({ scopes: [FULL_ACCESS_SENTINEL], fullAccess: true });
  });

  it('unions --add onto the current set', () => {
    const result = computeRescope(['gmail', 'calendar'], { add: 'drive,docs' });
    expect(result.fullAccess).toBe(false);
    expect(result.scopes).toEqual(['gmail', 'calendar', 'drive', 'docs']);
  });

  it('subtracts --remove from the current set', () => {
    const result = computeRescope(['gmail', 'calendar', 'drive'], { remove: 'calendar' });
    expect(result.scopes).toEqual(['gmail', 'drive']);
  });

  it('replaces the whole set with --set', () => {
    const result = computeRescope(['gmail', 'calendar', 'drive'], { set: 'sheets,slides' });
    expect(result.scopes).toEqual(['sheets', 'slides']);
  });

  it('applies --add and --remove together on top of --set', () => {
    const result = computeRescope(['gmail'], { set: 'gmail,calendar', add: 'drive', remove: 'gmail' });
    expect(result.scopes).toEqual(['calendar', 'drive']);
  });

  it('strips the full-access sentinel from the current base before applying ops', () => {
    const result = computeRescope([FULL_ACCESS_SENTINEL], { add: 'gmail' });
    expect(result.scopes).toEqual(['gmail']);
  });

  it('does not duplicate a service already present when added', () => {
    const result = computeRescope(['gmail'], { add: 'gmail,calendar' });
    expect(result.scopes).toEqual(['gmail', 'calendar']);
  });

  it('throws RESCOPE_NO_OPS when no operation is requested', () => {
    try {
      computeRescope(['gmail'], {});
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('RESCOPE_NO_OPS');
    }
  });

  it('throws RESCOPE_EMPTY when the result would be empty', () => {
    try {
      computeRescope(['gmail'], { remove: 'gmail' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('RESCOPE_EMPTY');
    }
  });
});
