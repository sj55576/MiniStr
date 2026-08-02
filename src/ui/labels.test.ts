import { describe, expect, it } from 'vitest';
import { unitTokens } from './labels';

describe('unit board tokens', () => {
  it('uses a distinct non-empty symbol for every unit kind', () => {
    const values = Object.values(unitTokens);
    expect(values.every(value => value.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});
