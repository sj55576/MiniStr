/**
 * Board scaling. Touch targets are the constraint: the base tile is sized for a
 * finger, and the default zoom enlarges small boards on roomy screens instead of
 * shrinking large ones below a tappable size.
 */
export const BOARD_BASE_TILE_SIZE = 44;
export const BOARD_ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 2] as const;
/** Horizontal space the viewport loses to the battlefield frame's padding and border. */
export const BOARD_VIEWPORT_GUTTER = 56;
/** Kept in step with `.game-shell`, `.battle-layout`, and their breakpoints in style.css. */
const SHELL_MAX_WIDTH = 1440;
const COMMAND_PANEL_WIDTH = 290;
const LAYOUT_GAP = 20;
const SINGLE_COLUMN_BREAKPOINT = 900;
const COMPACT_BREAKPOINT = 640;
/** Zoom never defaults below a full-size tile, so a first tap is always reachable. */
const MINIMUM_DEFAULT_INDEX = BOARD_ZOOM_LEVELS.indexOf(1);
/** Nor above 150%: past that a mid-size board needs scrolling on a desktop screen. */
const MAXIMUM_DEFAULT_INDEX = BOARD_ZOOM_LEVELS.indexOf(1.5);

export const clampBoardZoomIndex = (index: number): number =>
  Math.max(0, Math.min(BOARD_ZOOM_LEVELS.length - 1, Math.trunc(index)));

export function boardTileSize(zoomIndex: number): number {
  return Math.round(BOARD_BASE_TILE_SIZE * BOARD_ZOOM_LEVELS[clampBoardZoomIndex(zoomIndex)]!);
}

/** Percentage shown next to the zoom controls. */
export function boardZoomPercent(zoomIndex: number): number {
  return Math.round(BOARD_ZOOM_LEVELS[clampBoardZoomIndex(zoomIndex)]! * 100);
}

/**
 * Width the board may occupy at a given window width. Derived from the layout
 * rather than measured so the default zoom is decided before the first paint.
 */
export function boardAreaWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return 0;
  const shellWidth = Math.min(windowWidth, SHELL_MAX_WIDTH);
  if (windowWidth <= COMPACT_BREAKPOINT) return shellWidth - 20;
  if (windowWidth <= SINGLE_COLUMN_BREAKPOINT) return shellWidth - 40;
  return shellWidth - 40 - LAYOUT_GAP - COMMAND_PANEL_WIDTH;
}

/**
 * Largest zoom that still fits the board's width, bounded so phones keep
 * full-size tiles (and scroll) while small scenarios fill a wide screen.
 */
export function defaultBoardZoomIndex(viewportWidth: number, boardWidth: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(boardWidth) || boardWidth <= 0) return MINIMUM_DEFAULT_INDEX;
  let index = MINIMUM_DEFAULT_INDEX;
  while (index < MAXIMUM_DEFAULT_INDEX && boardWidth * boardTileSize(index + 1) + BOARD_VIEWPORT_GUTTER <= viewportWidth) index += 1;
  return index;
}
