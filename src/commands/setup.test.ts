import { describe, it, expect } from 'vitest';
import { compareSemver } from './setup.js';

describe('compareSemver', () => {
  it('returns 0 for identical versions', () => {
    expect(compareSemver('0.20.0', '0.20.0')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('10.20.30', '10.20.30')).toBe(0);
  });

  it('returns -1 when first version is lower', () => {
    expect(compareSemver('0.19.0', '0.20.0')).toBe(-1);
    expect(compareSemver('0.20.0', '0.20.1')).toBe(-1);
    expect(compareSemver('0.20.0', '1.0.0')).toBe(-1);
    expect(compareSemver('0.9.99', '0.20.0')).toBe(-1); // 9 < 20 numeric, not lex
  });

  it('returns 1 when first version is higher', () => {
    expect(compareSemver('0.20.0', '0.19.0')).toBe(1);
    expect(compareSemver('0.21.0', '0.20.5')).toBe(1);
    expect(compareSemver('1.0.0', '0.99.99')).toBe(1);
    expect(compareSemver('0.20.0', '0.9.99')).toBe(1); // numeric, not lex
  });

  it('treats missing components as 0', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.1')).toBe(-1);
  });

  it('handles the documented minimum boundary correctly', () => {
    // 0.20.0 is the documented MIN_GWS_VERSION
    expect(compareSemver('0.19.99', '0.20.0')).toBe(-1);
    expect(compareSemver('0.20.0', '0.20.0')).toBe(0);
    expect(compareSemver('0.20.1', '0.20.0')).toBe(1);
    expect(compareSemver('0.22.5', '0.20.0')).toBe(1);
  });
});
