import './style.css';
import { attackUnit, captureProperty, createGameState, endTurn, maps, moveUnit, produceUnit, reachablePositions, type GameState, type Position, type UnitKind, unitStats, visibleEnemies, visiblePositions } from './game';
import { chooseCpuAction } from './ai';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let message = 'ユニットを選択して行動してください。';
const app = document.querySelector<HTMLDivElement>('#app')!;

function start(id: string): GameState {
  selectedMap = maps.find(map => map.id === id) ?? maps[0]!;
  const state = createGameState(selectedMap.board);
  return { ...state, players: { red: { gold: selectedMap.startingGold, income: 0 }, blue: { gold: selectedMap.startingGold, income: 0 } }, units: [
    { id: 'r1', kind: 'infantry', owner: 'red', position: { x: 0, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
    { id: 'r2', kind: 'tank', owner: 'red', position: { x: 1, y: 1 }, hp: 100, hasMoved: false, hasActed: false },
    { id: 'b1', kind: 'infantry', owner: 'blue', position: { x: state.board.width - 1, y: state.board.height - 2 }, hp: 100, hasMoved: false, hasActed: false },
    { id: 'b2', kind: 'tank', owner: 'blue', position: { x: state.board.width - 2, y: state.board.height - 2 }, hp: 100, hasMoved: false, hasActed: false },
  ] };
}
const key = (p: Position) => `${p.x},${p.y}`;
function render(): void {
  const visible = new Set(visiblePositions(game, game.activePlayer).map(key));
  const movable = selected ? new Set(reachablePositions(game, selected).map(key)) : new Set<string>();
  const board = game.board.terrain.flatMap((row, y) => row.map((terrain, x) => {
    const unit = game.units.find(item => item.position.x === x && item.position.y === y);
    const hidden = game.activePlayer === 'red' && !visible.has(`${x},${y}`);
    const label = unit && !hidden ? `<span class="unit ${unit.owner}">${unit.kind.slice(0, 1).toUpperCase()}<small>${unit.hp}</small></span>` : '';
    return `<button class="tile ${terrain.kind} ${movable.has(`${x},${y}`) ? 'reachable' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" title="${terrain.kind}">${label}</button>`;
  })).join('');
  const production = (['infantry', 'tank', 'artillery', 'fighter', 'bomber', 'destroyer'] as UnitKind[]).map(kind => `<button class="produce" data-kind="${kind}" ${game.activePlayer !== 'red' ? 'disabled' : ''}>${kind} (${unitStats[kind].cost})</button>`).join('');
  app.innerHTML = `<main><header><h1>MiniStr</h1><select id="map">${maps.map(map => `<option value="${map.id}" ${map.id === selectedMap.id ? 'selected' : ''}>${map.name}</option>`).join('')}</select><strong>${game.activePlayer === 'red' ? 'プレイヤー' : 'CPU'}の手番</strong><button id="end">ターン終了</button></header><p>${message}</p><section class="layout"><div class="board" style="grid-template-columns:repeat(${game.board.width},1fr)">${board}</div><aside><h2>資金</h2><p>赤 ${game.players.red.gold} / 青 ${game.players.blue.gold}</p><h2>生産</h2>${production}<h2>索敵</h2><p>${visibleEnemies(game, game.activePlayer).length} 敵部隊を確認</p><small>黄色: 移動可能　霧: 未索敵<br/>航空・艦艇は燃料/弾薬を消費します。</small></aside></section></main>`;
  document.querySelector<HTMLSelectElement>('#map')!.onchange = event => { game = start((event.target as HTMLSelectElement).value); selected = undefined; render(); };
  document.querySelector<HTMLButtonElement>('#end')!.onclick = () => { game = endTurn(game); selected = undefined; if (game.activePlayer === 'blue') runCpu(); message = 'CPU が行動しました。'; render(); };
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => tile.onclick = () => act({ x: Number(tile.dataset.x), y: Number(tile.dataset.y) }));
  app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = () => { const factory = game.board.terrain.flatMap((row,y) => row.map((tile,x) => ({ tile,x,y }))).find(item => item.tile.kind === 'factory' && item.tile.owner === game.activePlayer); if (factory) { const result = produceUnit(game, { x: factory.x, y: factory.y }, button.dataset.kind as UnitKind); if (result.ok) game = result.value; else message = result.error; render(); } });
}
function act(position: Position): void { const target = game.units.find(unit => key(unit.position) === key(position)); if (target?.owner === game.activePlayer) { selected = target.id; message = `${target.kind}を選択しました。`; } else if (target && selected) { const result = attackUnit(game, selected, target.id); if (result.ok) { game = result.value; message = '攻撃しました。'; } else message = result.error; selected = undefined; } else if (selected) { const result = moveUnit(game, selected, position); if (result.ok) { game = result.value; message = '移動しました。'; } else message = result.error; } render(); }
function runCpu(): void {
  for (let steps = 0; steps < 30 && game.activePlayer === 'blue' && !game.winner; steps += 1) {
    const action = chooseCpuAction(game, 'normal');
    if (action.type === 'endTurn') { game = endTurn(game); break; }
    const result = action.type === 'attack' ? attackUnit(game, action.unitId, action.targetId)
      : action.type === 'capture' ? captureProperty(game, action.unitId)
      : action.type === 'move' ? moveUnit(game, action.unitId, action.destination)
      : produceUnit(game, action.factory, action.kind);
    if (result.ok) game = result.value; else { game = endTurn(game); break; }
  }
}
render();
