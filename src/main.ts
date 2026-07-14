import './style.css';
import { attackUnit, captureProperty, createGameState, endTurn, maps, moveUnit, produceUnit, reachablePositions, type GameState, type Position, type UnitKind, unitStats, visibleEnemies, visiblePositions } from './game';
import { chooseCpuAction } from './ai';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let message = 'ユニットを選択して行動してください。';
const app = document.querySelector<HTMLDivElement>('#app')!;

const terrainNames: Record<string, string> = {
  plain: '平原', forest: '森林', mountain: '山岳', road: '道路', sea: '海',
  city: '都市', factory: '工場', capital: '司令部',
};
const unitIcons: Record<UnitKind, string> = {
  infantry: '♟', tank: '◆', artillery: '✦', fighter: '▲', bomber: '▼', destroyer: '✚',
};
const unitNames: Record<UnitKind, string> = {
  infantry: '歩兵', tank: '戦車', artillery: '砲兵', fighter: '戦闘機', bomber: '爆撃機', destroyer: '駆逐艦',
};

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
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);

function render(): void {
  const visible = new Set(visiblePositions(game, game.activePlayer).map(key));
  const movable = selected ? new Set(reachablePositions(game, selected).map(key)) : new Set<string>();
  const board = game.board.terrain.flatMap((row, y) => row.map((terrain, x) => {
    const unit = game.units.find(item => item.position.x === x && item.position.y === y);
    const hidden = game.activePlayer === 'red' && !visible.has(`${x},${y}`);
    const terrainName = terrainNames[terrain.kind] ?? terrain.kind;
    const unitLabel = unit && !hidden ? `${unit.owner === 'red' ? 'プレイヤー' : 'CPU'}の${unitNames[unit.kind]}、耐久 ${unit.hp}` : '';
    const label = unit && !hidden
      ? `<span class="unit ${unit.owner} unit-${unit.kind}" aria-hidden="true"><b>${unitIcons[unit.kind]}</b><small>${unit.hp}</small></span>`
      : '';
    const status = movable.has(`${x},${y}`) ? '、移動可能' : hidden ? '、未索敵' : '';
    return `<button class="tile ${terrain.kind} ${unit?.id === selected ? 'selected' : ''} ${movable.has(`${x},${y}`) ? 'reachable' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" data-terrain="${terrain.kind}" title="${terrainName}${unitLabel ? ` — ${unitLabel}` : ''}" aria-label="${terrainName}${unitLabel ? `、${unitLabel}` : ''}${status}">${label}</button>`;
  })).join('');
  const production = (['infantry', 'tank', 'artillery', 'fighter', 'bomber', 'destroyer'] as UnitKind[]).map(kind => `<button class="produce produce-${kind}" data-kind="${kind}" ${game.activePlayer !== 'red' ? 'disabled' : ''} title="${unitNames[kind]}を生産 (${unitStats[kind].cost}G)" aria-label="${unitNames[kind]}を${unitStats[kind].cost}ゴールドで生産"><span aria-hidden="true">${unitIcons[kind]}</span>${unitNames[kind]} <em>${unitStats[kind].cost}G</em></button>`).join('');
  const activeLabel = game.activePlayer === 'red' ? 'プレイヤー' : 'CPU';
  app.innerHTML = `<main class="game-shell">
    <header class="command-bar"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>MiniStr</h1><p>TACTICAL COMMAND</p></div></div><label class="map-picker">戦域<select id="map" aria-label="戦域マップを選択">${maps.map(map => `<option value="${map.id}" ${map.id === selectedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</select></label><div class="turn-indicator ${game.activePlayer}"><span>TURN</span><strong>${activeLabel}</strong></div><button id="end" class="end-turn" title="現在のターンを終了" aria-label="ターンを終了する">ターン終了 <span aria-hidden="true">→</span></button></header>
    <section class="battle-layout"><div class="battlefield-wrap"><div class="battlefield-heading"><div><p>OPERATION MAP</p><h2>${escapeHtml(selectedMap.name)}</h2></div><p class="status-message" aria-live="polite">${escapeHtml(message)}</p></div><div class="board" role="grid" aria-label="${escapeHtml(selectedMap.name)}の戦術マップ" style="grid-template-columns:repeat(${game.board.width},1fr)">${board}</div><div class="map-legend" aria-label="マップ凡例"><span><i class="legend-dot reachable-dot"></i>移動可能</span><span><i class="legend-dot fog-dot"></i>未索敵</span><span><i class="legend-unit red-dot"></i>自軍</span><span><i class="legend-unit blue-dot"></i>敵軍</span></div></div>
    <aside class="command-panel" aria-label="作戦情報"><section class="commander-card"><img src="./assets/commander-red.png" alt="赤軍司令官の肖像"><div><p>COMMANDER</p><h2>RED COMMAND</h2><span>前線司令部</span></div></section><section class="intel-card"><p class="card-kicker">RESOURCES</p><div class="resource-row"><span>自軍資金</span><strong>${game.players.red.gold}<small>G</small></strong></div><div class="resource-row enemy"><span>敵軍資金</span><strong>${game.players.blue.gold}<small>G</small></strong></div></section><section class="intel-card"><p class="card-kicker">RECON</p><div class="recon-count"><strong>${visibleEnemies(game, game.activePlayer).length}</strong><span>確認済み敵部隊</span></div></section><section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>ユニット生産</h2></div><div class="production-grid">${production}</div></section><p class="command-tip">部隊を選択して移動・攻撃。航空・艦艇は燃料と弾薬を消費します。</p></aside>
  </section></main>`;
  document.querySelector<HTMLSelectElement>('#map')!.onchange = event => { game = start((event.target as HTMLSelectElement).value); selected = undefined; render(); };
  document.querySelector<HTMLButtonElement>('#end')!.onclick = () => { game = endTurn(game); selected = undefined; if (game.activePlayer === 'blue') runCpu(); message = 'CPU が行動しました。'; render(); };
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => tile.onclick = () => act({ x: Number(tile.dataset.x), y: Number(tile.dataset.y) }));
  app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = () => { const factory = game.board.terrain.flatMap((row,y) => row.map((tile,x) => ({ tile,x,y }))).find(item => item.tile.kind === 'factory' && item.tile.owner === game.activePlayer); if (factory) { const result = produceUnit(game, { x: factory.x, y: factory.y }, button.dataset.kind as UnitKind); if (result.ok) game = result.value; else message = result.error; render(); } });
}

function act(position: Position): void { const target = game.units.find(unit => key(unit.position) === key(position)); if (target?.owner === game.activePlayer) { selected = target.id; message = `${unitNames[target.kind]}を選択しました。`; } else if (target && selected) { const result = attackUnit(game, selected, target.id); if (result.ok) { game = result.value; message = '攻撃しました。'; } else message = result.error; selected = undefined; } else if (selected) { const result = moveUnit(game, selected, position); if (result.ok) { game = result.value; message = '移動しました。'; } else message = result.error; } render(); }
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
