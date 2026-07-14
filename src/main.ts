import "./style.css";
import { CanvasBoard, type BoardAction } from "./ui/canvas-board";
import { type Coordinate, type GameView, type UnitView } from "./ui/types";

/*
 * The core module is deliberately kept behind this small adapter.  Its public
 * API is pure: every command receives the current state and returns the next.
 * If the domain model changes, only this file needs to be updated.
 */
import { attackUnit, createGameState, endTurn, getReachablePositions, moveUnit, type GameState } from "./core/game";

let game: GameState = createGameState();
let selectedUnitId: string | undefined;
let reachable: Coordinate[] = [];
let notice = "自軍ユニットを選んでください。";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The app root could not be found.");

app.innerHTML = `
  <main class="game-shell" aria-label="MiniStr tactical game">
    <section class="board-card" aria-label="戦場">
      <canvas id="board" role="application" aria-label="マップ。ユニットをクリックして行動します"></canvas>
    </section>
    <aside class="sidebar" aria-live="polite">
      <header><p class="eyebrow">turn-based tactics</p><h1>MiniStr</h1></header>
      <div id="turn" class="turn"></div>
      <p id="guide" class="guide"></p>
      <div class="legend"><div><span class="friendly"></span>味方ユニット</div><div><span class="hostile"></span>敵ユニット</div><div><span class="range"></span>移動可能なマス</div></div>
      <p id="winner" class="winner" hidden></p>
      <button id="end-turn" class="end-turn" type="button">ターン終了</button>
    </aside>
  </main>`;

const canvas = document.querySelector<HTMLCanvasElement>("#board");
const turn = document.querySelector<HTMLDivElement>("#turn");
const guide = document.querySelector<HTMLParagraphElement>("#guide");
const winner = document.querySelector<HTMLParagraphElement>("#winner");
const endTurnButton = document.querySelector<HTMLButtonElement>("#end-turn");
if (!canvas || !turn || !guide || !winner || !endTurnButton) throw new Error("The game UI could not be initialized.");

const view = (): GameView => ({
  width: game.boardSize,
  height: game.boardSize,
  currentPlayer: game.activePlayer,
  winner: game.winner,
  units: game.units.map((unit) => ({
    id: unit.id,
    owner: unit.player,
    type: unit.type,
    position: unit.position,
    hp: unit.hp,
    maxHp: 10,
    moved: unit.hasMoved,
    attacked: unit.hasAttacked,
  })),
});
const selectedUnit = (): UnitView | undefined => view().units.find((unit) => unit.id === selectedUnitId);
const playerName = (player: GameView["currentPlayer"]): string => player === "blue" ? "プレイヤー" : "敵";

const board = new CanvasBoard(canvas, (action) => handleAction(action));

function refresh(): void {
  const state = view();
  const selected = selectedUnit();
  const isOver = Boolean(state.winner);
  turn!.textContent = isOver ? "ゲーム終了" : `${playerName(state.currentPlayer)}の手番`;
  turn!.classList.toggle("enemy", state.currentPlayer === "red");
  guide!.textContent = notice;
  winner!.hidden = !isOver;
  winner!.textContent = isOver ? `${playerName(state.winner!)}の勝利！` : "";
  endTurnButton!.disabled = isOver;
  board.render({ game: state, selectedUnitId: selected?.id, reachable, message: notice });
}

function select(unit: UnitView): void {
  if (unit.owner !== view().currentPlayer) {
    notice = "今はそのユニットを操作できません。";
    return;
  }
  selectedUnitId = unit.id;
  reachable = getReachablePositions(game, unit.id);
  notice = "移動先を選ぶか、隣接する敵を選んで攻撃します。";
}

function handleAction(action: BoardAction): void {
  if (view().winner) return;
  try {
    if (action.type === "select") select(action.unit);
    if (action.type === "move") {
      if (!selectedUnitId) return;
      game = moveUnit(game, selectedUnitId, action.destination);
      reachable = [];
      notice = "移動しました。攻撃する敵を選ぶか、ターンを終了してください。";
    }
    if (action.type === "attack") {
      if (!selectedUnitId) { notice = "先に自軍ユニットを選んでください。"; }
      else {
        game = attackUnit(game, selectedUnitId, action.target.id);
        reachable = [];
        notice = "攻撃しました。ターンを終了してください。";
      }
    }
    if (action.type === "clear") {
      selectedUnitId = undefined;
      reachable = [];
      notice = "自軍ユニットを選んでください。";
    }
  } catch (error) {
    notice = error instanceof Error ? error.message : "その行動は実行できません。";
  }
  refresh();
}

endTurnButton.addEventListener("click", () => {
  if (view().winner) return;
  try {
    game = endTurn(game);
    selectedUnitId = undefined;
    reachable = [];
    notice = "自軍ユニットを選んでください。";
  } catch (error) {
    notice = error instanceof Error ? error.message : "ターンを終了できません。";
  }
  refresh();
});

refresh();
