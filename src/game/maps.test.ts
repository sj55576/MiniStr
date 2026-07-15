import { describe, expect, it } from 'vitest';
import { maps, unitStats } from './index';

describe('expanded map roster', () => {
  it('offers four distinct scenarios with map-owned starting forces', () => {
    expect(maps.map(map => map.id)).toEqual(['skirmish', 'islands', 'canyon', 'siege']);
    for (const map of maps) {
      expect(map.initialUnits.some(unit => unit.owner === 'red')).toBe(true);
      expect(map.initialUnits.some(unit => unit.owner === 'blue')).toBe(true);
      for (const unit of map.initialUnits) {
        expect(unit.x).toBeGreaterThanOrEqual(0);
        expect(unit.y).toBeGreaterThanOrEqual(0);
        expect(unit.x).toBeLessThan(map.board.width);
        expect(unit.y).toBeLessThan(map.board.height);
      }
    }
  });

  it('adds reconnaissance cars and self-propelled rocket artillery', () => {
    expect(unitStats.recon).toMatchObject({ movement: 7, vision: 5 });
    expect(unitStats.rocket).toMatchObject({ range: [3, 5], attack: 90 });
    expect(maps.some(map => map.initialUnits.some(unit => unit.kind === 'recon'))).toBe(true);
    expect(maps.some(map => map.initialUnits.some(unit => unit.kind === 'rocket'))).toBe(true);
  });
});
