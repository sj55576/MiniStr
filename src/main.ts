import './style.css';
import { attackUnit, captureProperty, createGameState, endTurn, forecastCombat, maps, moveUnit, produceUnit, reachablePositions, type GameState, type Position, type UnitKind, unitStats, visibleEnemies, visiblePositions } from './game';
import { chooseCpuAction, type CpuDifficulty } from './ai';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let message = 'ユニットを選択して行動してください。';
let difficulty: CpuDifficulty = 'normal';
const app = document.querySelector<HTMLDivElement>('#app')!;
const difficultyNames: Record<CpuDifficulty, string> = { easy: '易しい', normal: '普通', hard: '難しい' };

const terrainNames: Record<string, string> = {
  plain: '平原', forest: '森林', mountain: '山岳', road: '道路', sea: '海',
  city: '都市', factory: '工場', capital: '司令部',
};
const unitTokens: Record<UnitKind, string> = {
  infantry: '歩', tank: '戦', artillery: '砲', fighter: '戦', bomber: '爆', destroyer: '艦', recon: '偵', rocket: '自',
};
const unitNames: Record<UnitKind, string> = {
  infantry: '歩兵', tank: '戦車', artillery: '砲兵', fighter: '戦闘機', bomber: '爆撃機', destroyer: '駆逐艦', recon: '偵察車', rocket: '自走砲',
};
const producibleUnits: readonly UnitKind[] = ['infantry', 'recon', 'tank', 'artillery', 'rocket', 'fighter', 'bomber', 'destroyer'];

function start(id: string): GameState {
  selectedMap = maps.find(map => map.id === id) ?? maps[0]!;
  const state = createGameState(selectedMap.board);
  return { ...state, players: { red: { gold: selectedMap.startingGold, income: 0 }, blue: { gold: selectedMap.startingGold, income: 0 } }, units: selectedMap.initialUnits.map((unit, index) => {
    const stats = unitStats[unit.kind];
    return { id: `${unit.owner[0]}${index + 1}`, kind: unit.kind, owner: unit.owner, position: { x: unit.x, y: unit.y }, hp: 100, fuel: stats.fuel, ammo: stats.ammo, hasMoved: false, hasActed: false };
  }) };
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
    const isProperty = terrain.kind === 'city' || terrain.kind === 'factory' || terrain.kind === 'capital';
    const propertyOwner = isProperty ? terrain.owner : undefined;
    const capturePoints = isProperty ? terrain.capturePoints : undefined;
    const propertyLabel = isProperty ? `${terrainName}${propertyOwner ? `（${propertyOwner === 'red' ? '自軍' : '敵軍'}）` : '（中立）'}${capturePoints !== undefined ? `、占領値 ${capturePoints}` : ''}` : terrainName;
    const unitLabel = unit && !hidden ? `${unit.owner === 'red' ? 'プレイヤー' : 'CPU'}の${unitNames[unit.kind]}、耐久 ${unit.hp}` : '';
    const label = unit && !hidden
      ? `<span class="unit ${unit.owner} unit-${unit.kind}" aria-hidden="true"><b>${unitTokens[unit.kind]}</b><small>${unit.hp}</small><em>${unitNames[unit.kind]}</em></span>`
      : '';
    const facility = isProperty && !hidden
      ? `<span class="facility facility-${terrain.kind} ${propertyOwner ?? 'neutral'}" aria-hidden="true"><b>${terrain.kind === 'city' ? '市' : terrain.kind === 'factory' ? '工' : '司'}</b><small>${propertyOwner === 'red' ? '自軍' : propertyOwner === 'blue' ? '敵軍' : '中立'}${capturePoints !== undefined ? ` ${capturePoints}` : ''}</small></span>`
      : '';
    const status = movable.has(`${x},${y}`) ? '、移動可能' : hidden ? '、未索敵' : '';
    return `<button class="tile ${terrain.kind} ${unit?.id === selected ? 'selected' : ''} ${movable.has(`${x},${y}`) ? 'reachable' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" data-terrain="${terrain.kind}" title="${propertyLabel}${unitLabel ? ` — ${unitLabel}` : ''}" aria-label="${propertyLabel}${unitLabel ? `、${unitLabel}` : ''}${status}">${facility}${label}</button>`;
  })).join('');
  const production = producibleUnits.map(kind => `<button class="produce produce-${kind}" data-kind="${kind}" ${game.activePlayer !== 'red' ? 'disabled' : ''} title="${unitNames[kind]}を生産 (${unitStats[kind].cost}G)" aria-label="${unitNames[kind]}を${unitStats[kind].cost}ゴールドで生産"><span aria-hidden="true">${unitTokens[kind]}</span>${unitNames[kind]} <em>${unitStats[kind].cost}G</em></button>`).join('');
  const activeLabel = game.activePlayer === 'red' ? 'プレイヤー' : 'CPU';
  const selectedUnit = game.units.find(unit => unit.id === selected);
  const selectedTerrain = selectedUnit ? game.board.terrain[selectedUnit.position.y]?.[selectedUnit.position.x] : undefined;
  const canCapture = selectedUnit?.owner === game.activePlayer && selectedUnit.kind === 'infantry' && selectedTerrain && ['city', 'factory', 'capital'].includes(selectedTerrain.kind) && selectedTerrain.owner !== game.activePlayer;
  const captureAction = canCapture ? `<section class="capture-card"><p class="card-kicker">PROPERTY ACTION</p><strong>${terrainNames[selectedTerrain!.kind]}を占領</strong><span>${selectedTerrain!.owner === 'blue' ? '敵軍' : '中立'}拠点・占領値 ${selectedTerrain!.capturePoints ?? '—'}</span><button class="capture" id="capture" aria-label="この拠点を占領する">占領する</button></section>` : '';
  const forecasts = selectedUnit && selectedUnit.owner === game.activePlayer
    ? game.units.filter(unit => unit.owner !== selectedUnit.owner).map(enemy => ({ enemy, forecast: forecastCombat(game, selectedUnit, enemy) })).filter((item): item is { enemy: typeof item.enemy; forecast: Extract<typeof item.forecast, { ok: true }> } => item.forecast.ok)
    : [];
  const forecastCard = forecasts.length > 0 ? `<section class="forecast-card"><p class="card-kicker">戦闘予測</p>${forecasts.map(({ enemy, forecast }) => `<div class="forecast-row"><span>${unitNames[enemy.kind]}（耐久 ${enemy.hp}）</span><span class="forecast-damage">与 ${forecast.value.defenderDamage}</span><span class="forecast-counter">被 ${forecast.value.canCounter ? forecast.value.counterDamage : 'なし'}</span></div>`).join('')}${selectedUnit!.hasActed ? '<p class="forecast-note">このユニットは行動済みです。</p>' : ''}</section>` : '';
  const gameOverOverlay = game.winner ? `<div class="game-over"><div class="game-over-card"><p class="card-kicker">RESULT</p><h2>${game.winner === 'red' ? 'プレイヤーの勝利' : 'CPUの勝利'}</h2><button id="restart" class="end-turn">もう一度</button></div></div>` : '';
  const commander = game.activePlayer === 'red'
    ? { image: './assets/commander-red.png', alt: '赤軍司令官の肖像', title: 'RED COMMAND', label: '前線司令部' }
    : { image: './assets/commander-blue.png', alt: '青軍司令官の肖像', title: 'BLUE COMMAND', label: '敵軍司令部' };
  const mapTheme = selectedMap.id === 'canyon' ? 'desert' : '';
  app.innerHTML = `<main class="game-shell">
    <header class="command-bar"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>MiniStr</h1><p>TACTICAL COMMAND</p></div></div><label class="map-picker">戦域<select id="map" aria-label="戦域マップを選択">${maps.map(map => `<option value="${map.id}" ${map.id === selectedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</select></label><label class="map-picker">難易度<select id="difficulty" aria-label="CPUの難易度を選択">${(['easy', 'normal', 'hard'] as CpuDifficulty[]).map(level => `<option value="${level}" ${level === difficulty ? 'selected' : ''}>${difficultyNames[level]}</option>`).join('')}</select></label><div class="turn-indicator ${game.activePlayer}"><span>TURN</span><strong>${activeLabel}</strong></div><button id="end" class="end-turn" title="現在のターンを終了" aria-label="ターンを終了する">ターン終了 <span aria-hidden="true">→</span></button></header>
    <section class="battle-layout"><div class="battlefield-wrap ${mapTheme}"><div class="battlefield-heading"><div><p>OPERATION MAP</p><h2>${escapeHtml(selectedMap.name)}</h2></div><p class="status-message" aria-live="polite">${escapeHtml(message)}</p></div><div class="board" role="grid" aria-label="${escapeHtml(selectedMap.name)}の戦術マップ" style="grid-template-columns:repeat(${game.board.width},1fr)">${board}</div><div class="map-legend" aria-label="マップ凡例"><span><i class="legend-dot reachable-dot"></i>移動可能</span><span><i class="legend-dot fog-dot"></i>未索敵</span><span><i class="legend-unit red-dot"></i>自軍</span><span><i class="legend-unit blue-dot"></i>敵軍</span><span><i class="legend-facility"></i>拠点（市・工・司）</span></div></div>
    <aside class="command-panel" aria-label="作戦情報"><section class="commander-card ${game.activePlayer}"><img src="${commander.image}" alt="${commander.alt}"><div><p>COMMANDER</p><h2>${commander.title}</h2><span>${commander.label}</span></div></section>${captureAction}${forecastCard}<section class="intel-card"><p class="card-kicker">RESOURCES</p><div class="resource-row"><span>自軍資金</span><strong>${game.players.red.gold}<small>G</small></strong></div><div class="resource-row enemy"><span>敵軍資金</span><strong>${game.players.blue.gold}<small>G</small></strong></div></section><section class="intel-card"><p class="card-kicker">RECON</p><div class="recon-count"><strong>${visibleEnemies(game, game.activePlayer).length}</strong><span>確認済み敵部隊</span></div></section><section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>ユニット生産</h2></div><div class="production-grid">${production}</div></section><p class="command-tip">歩兵は中立・敵軍の都市、工場、司令部で<strong>占領</strong>できます。拠点は毎ターン資金を供給し、工場では生産できます。</p></aside>
  </section></main>${gameOverOverlay}`;
  document.querySelector<HTMLSelectElement>('#map')!.onchange = event => { game = start((event.target as HTMLSelectElement).value); selected = undefined; render(); };
  document.querySelector<HTMLSelectElement>('#difficulty')!.onchange = event => { difficulty = (event.target as HTMLSelectElement).value as CpuDifficulty; render(); };
  document.querySelector<HTMLButtonElement>('#end')!.onclick = () => { game = endTurn(game); selected = undefined; if (game.activePlayer === 'blue') runCpu(); message = 'CPU が行動しました。'; render(); };
  app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => tile.onclick = () => act({ x: Number(tile.dataset.x), y: Number(tile.dataset.y) }));
  app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = () => { const factory = game.board.terrain.flatMap((row,y) => row.map((tile,x) => ({ tile,x,y }))).find(item => item.tile.kind === 'factory' && item.tile.owner === game.activePlayer); if (factory) { const result = produceUnit(game, { x: factory.x, y: factory.y }, button.dataset.kind as UnitKind); if (result.ok) game = result.value; else message = result.error; render(); } });
  document.querySelector<HTMLButtonElement>('#capture')?.addEventListener('click', () => {
    if (!selected) return;
    const result = captureProperty(game, selected);
    if (result.ok) { game = result.value; message = '拠点の占領を進めました。'; } else message = result.error;
    render();
  });
  document.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', () => {
    game = start(selectedMap.id); selected = undefined; message = 'ユニットを選択して行動してください。'; render();
  });
}

function act(position: Position): void { const target = game.units.find(unit => key(unit.position) === key(position)); if (target?.owner === game.activePlayer) { selected = target.id; message = `${unitNames[target.kind]}を選択しました。`; } else if (target && selected) { const result = attackUnit(game, selected, target.id); if (result.ok) { game = result.value; message = '攻撃しました。'; } else message = result.error; selected = undefined; } else if (selected) { const result = moveUnit(game, selected, position); if (result.ok) { game = result.value; message = '移動しました。'; } else message = result.error; } render(); }
function runCpu(): void {
  for (let steps = 0; steps < 30 && game.activePlayer === 'blue' && !game.winner; steps += 1) {
    const action = chooseCpuAction(game, difficulty);
    if (action.type === 'endTurn') { game = endTurn(game); break; }
    const result = action.type === 'attack' ? attackUnit(game, action.unitId, action.targetId)
      : action.type === 'capture' ? captureProperty(game, action.unitId)
      : action.type === 'move' ? moveUnit(game, action.unitId, action.destination)
      : produceUnit(game, action.factory, action.kind);
    if (result.ok) game = result.value; else { game = endTurn(game); break; }
  }
}
render();
