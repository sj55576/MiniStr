import { positionKey, samePosition, type Coordinate, type GameView, type UnitView } from "./types";

export type BoardAction =
  | { type: "select"; unit: UnitView }
  | { type: "move"; destination: Coordinate }
  | { type: "attack"; target: UnitView }
  | { type: "clear" };

interface DrawState {
  game: GameView;
  selectedUnitId?: string;
  reachable: Coordinate[];
  message?: string;
}

const COLORS = {
  grid: "#435268",
  light: "#162033",
  dark: "#111a2a",
  player: "#5eead4",
  enemy: "#fb7185",
  reachable: "#fbbf24",
  selected: "#f8fafc",
  text: "#e5eefb",
};

export class CanvasBoard {
  private readonly context: CanvasRenderingContext2D;
  private drawState?: DrawState;
  private cellSize = 1;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onAction: (action: BoardAction) => void) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    this.context = context;
    canvas.addEventListener("click", this.handleClick);
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  public render(drawState: DrawState): void {
    this.drawState = drawState;
    this.draw();
  }

  public destroy(): void {
    this.canvas.removeEventListener("click", this.handleClick);
  }

  private draw = (): void => {
    if (!this.drawState) return;
    const { game } = this.drawState;
    const rect = this.canvas.getBoundingClientRect();
    const side = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(side * dpr);
    this.canvas.height = Math.floor(side * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cellSize = side / Math.max(game.width, game.height);
    this.context.clearRect(0, 0, side, side);

    const boardWidth = game.width * this.cellSize;
    const boardHeight = game.height * this.cellSize;
    const offsetX = (side - boardWidth) / 2;
    const offsetY = (side - boardHeight) / 2;
    this.context.save();
    this.context.translate(offsetX, offsetY);

    for (let y = 0; y < game.height; y += 1) {
      for (let x = 0; x < game.width; x += 1) {
        this.context.fillStyle = (x + y) % 2 ? COLORS.dark : COLORS.light;
        this.context.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
      }
    }

    const reachableKeys = new Set(this.drawState.reachable.map(positionKey));
    for (const position of this.drawState.reachable) {
      this.context.fillStyle = "rgba(251, 191, 36, .30)";
      this.context.fillRect(position.x * this.cellSize + 2, position.y * this.cellSize + 2, this.cellSize - 4, this.cellSize - 4);
      this.context.fillStyle = COLORS.reachable;
      this.context.beginPath();
      this.context.arc((position.x + .5) * this.cellSize, (position.y + .5) * this.cellSize, Math.max(3, this.cellSize * .08), 0, Math.PI * 2);
      this.context.fill();
    }

    for (const unit of game.units) this.drawUnit(unit, unit.id === this.drawState.selectedUnitId);

    this.context.strokeStyle = COLORS.grid;
    this.context.lineWidth = 1;
    for (let x = 0; x <= game.width; x += 1) {
      this.context.beginPath(); this.context.moveTo(x * this.cellSize, 0); this.context.lineTo(x * this.cellSize, boardHeight); this.context.stroke();
    }
    for (let y = 0; y <= game.height; y += 1) {
      this.context.beginPath(); this.context.moveTo(0, y * this.cellSize); this.context.lineTo(boardWidth, y * this.cellSize); this.context.stroke();
    }
    this.context.restore();
    void reachableKeys; // keeps the intent explicit: positions are rendered before units.
  };

  private drawUnit(unit: UnitView, selected: boolean): void {
    const { x, y } = unit.position;
    const centerX = (x + .5) * this.cellSize;
    const centerY = (y + .48) * this.cellSize;
    const radius = this.cellSize * .30;
    this.context.save();
    if (selected) {
      this.context.strokeStyle = COLORS.selected;
      this.context.lineWidth = Math.max(2, this.cellSize * .06);
      this.context.beginPath(); this.context.arc(centerX, centerY, radius + this.cellSize * .10, 0, Math.PI * 2); this.context.stroke();
    }
    this.context.globalAlpha = unit.moved || unit.attacked ? .54 : 1;
    this.context.fillStyle = unit.owner === "blue" ? COLORS.player : COLORS.enemy;
    this.context.beginPath(); this.context.arc(centerX, centerY, radius, 0, Math.PI * 2); this.context.fill();
    this.context.fillStyle = "#0f172a";
    this.context.font = `700 ${Math.max(11, this.cellSize * .25)}px system-ui`;
    this.context.textAlign = "center"; this.context.textBaseline = "middle";
    this.context.fillText(unit.type.slice(0, 1).toUpperCase(), centerX, centerY);
    const maxHp = unit.maxHp ?? unit.hp;
    const healthWidth = this.cellSize * .62;
    const healthX = centerX - healthWidth / 2;
    const healthY = (y + .82) * this.cellSize;
    this.context.fillStyle = "rgba(15, 23, 42, .8)";
    this.context.fillRect(healthX, healthY, healthWidth, Math.max(3, this.cellSize * .06));
    this.context.fillStyle = unit.owner === "blue" ? "#2dd4bf" : "#fb7185";
    this.context.fillRect(healthX, healthY, healthWidth * Math.max(0, Math.min(1, unit.hp / maxHp)), Math.max(3, this.cellSize * .06));
    this.context.restore();
  }

  private handleClick = (event: MouseEvent): void => {
    const state = this.drawState;
    if (!state || state.game.winner) return;
    const rect = this.canvas.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height);
    const offsetX = (rect.width - side) / 2;
    const offsetY = (rect.height - side) / 2;
    const x = Math.floor((event.clientX - rect.left - offsetX) / this.cellSize);
    const y = Math.floor((event.clientY - rect.top - offsetY) / this.cellSize);
    if (x < 0 || y < 0 || x >= state.game.width || y >= state.game.height) return;
    const position = { x, y };
    const unit = state.game.units.find((candidate) => samePosition(candidate.position, position));
    const selected = state.game.units.find((candidate) => candidate.id === state.selectedUnitId);
    if (unit && unit.owner === state.game.currentPlayer) return this.onAction({ type: "select", unit });
    if (unit && selected && unit.owner !== selected.owner) return this.onAction({ type: "attack", target: unit });
    if (!unit && selected && state.reachable.some((candidate) => samePosition(candidate, position))) return this.onAction({ type: "move", destination: position });
    this.onAction({ type: "clear" });
  };
}
