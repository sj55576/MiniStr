import { describe, expect, it } from 'vitest';
import { BOARD_ZOOM_LEVELS, boardAreaWidth, boardTileSize, boardZoomPercent, clampBoardZoomIndex, defaultBoardZoomIndex } from './boardZoom';

const zoomFor = (windowWidth: number, boardWidth: number) =>
  BOARD_ZOOM_LEVELS[defaultBoardZoomIndex(boardAreaWidth(windowWidth), boardWidth)];

describe('board zoom', () => {
  it('keeps the zoom index inside the available levels', () => {
    expect(clampBoardZoomIndex(-3)).toBe(0);
    expect(clampBoardZoomIndex(99)).toBe(BOARD_ZOOM_LEVELS.length - 1);
    expect(clampBoardZoomIndex(1.9)).toBe(1);
  });

  it('reports whole-pixel tiles and round percentages', () => {
    expect(boardTileSize(BOARD_ZOOM_LEVELS.indexOf(1))).toBe(44);
    expect(BOARD_ZOOM_LEVELS.every((_, index) => Number.isInteger(boardTileSize(index)))).toBe(true);
    expect(BOARD_ZOOM_LEVELS.map((_, index) => boardZoomPercent(index))).toEqual([75, 100, 125, 150, 200]);
  });

  it('reserves room for the command panel only on the two-column layout', () => {
    expect(boardAreaWidth(1440)).toBe(1090);
    expect(boardAreaWidth(880)).toBe(840);
    expect(boardAreaWidth(390)).toBe(370);
    expect(boardAreaWidth(0)).toBe(0);
  });

  it('never shrinks tiles below full size by default, even for a wide board on a phone', () => {
    expect(zoomFor(390, 14)).toBe(1);
    expect(boardTileSize(defaultBoardZoomIndex(boardAreaWidth(390), 14))).toBe(44);
  });

  it('enlarges a board that has room to spare, stopping at 150%', () => {
    expect(zoomFor(1440, 8)).toBe(1.5);
    expect(zoomFor(1440, 14)).toBe(1.5);
    expect(zoomFor(760, 12)).toBe(1.25);
    expect(zoomFor(700, 14)).toBe(1);
  });

  it('falls back to full size for unusable measurements', () => {
    expect(BOARD_ZOOM_LEVELS[defaultBoardZoomIndex(Number.NaN, 10)]).toBe(1);
    expect(BOARD_ZOOM_LEVELS[defaultBoardZoomIndex(1090, 0)]).toBe(1);
  });
});
