import './style.css';
import { applyGameCommand, AUTO_SAVE_KEY, createGameState, createReplay, deleteSaves, forecastCombat, hasSavedGame, loadGame, MANUAL_SAVE_KEY, maps, MAX_REPLAY_BYTES, parseReplay, reachablePositions, saveGame, serializeReplay, summarizeReplay, type GameCommand, type GameState, type Position, type ReplayFile, type UnitKind, unitStats, visibleEnemies, visiblePositions } from './game';
import { chooseCpuAction, type CpuDifficulty } from './ai';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let message = 'ユニットを選択して行動してください。';
let difficulty: CpuDifficulty = 'normal';
let initialState = structuredClone(game);
let commandHistory: GameCommand[] = [];
let undoStack: { state: GameState; commandCount: number }[] = [];
interface ReplayRuntime { file: ReplayFile; state: GameState; index: number; playing: boolean; speed: 0.5 | 1 | 2 | 4 }
let replay: ReplayRuntime | undefined;
let replayTimer: number | undefined;
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


function resetGame(mapId: string): void {
  game = start(mapId);
  initialState = structuredClone(game);
  commandHistory = [];
  undoStack = [];
  selected = undefined;
}
function dispatch(command: GameCommand, undoable = false): boolean {
  const result = applyGameCommand(game, command);
  if (!result.ok) { message = result.error; return false; }
  if (undoable && game.activePlayer === 'red') undoStack.push({ state: game, commandCount: commandHistory.length });
  game = result.value;
  commandHistory.push(command);
  return true;
}
function persist(key: string): boolean {
  const result = saveGame(localStorage, key, { mapId: selectedMap.id, difficulty, initialState, commands: commandHistory, gameState: game });
  message = result.ok ? 'セーブしました。' : result.error;
  return result.ok;
}
function hasSave(): boolean {
  return hasSavedGame(localStorage);
}
function continueSavedGame(): void {
  const loaded = loadGame(localStorage);
  if (!loaded) { message = 'セーブデータがありません。'; return; }
  if (!loaded.ok) { resetGame(selectedMap.id); message = loaded.error; return; }
  const map = maps.find(candidate => candidate.id === loaded.value.mapId);
  if (!map) { resetGame(selectedMap.id); message = 'セーブデータのマップは利用できません。'; return; }
  selectedMap = map;
  difficulty = loaded.value.difficulty;
  initialState = structuredClone(loaded.value.initialState);
  commandHistory = [...loaded.value.commands];
  game = structuredClone(loaded.value.gameState);
  undoStack = [];
  selected = undefined;
  message = 'セーブデータから再開しました。';
}


function clearReplayTimer(): void {
  if (replayTimer !== undefined) { window.clearTimeout(replayTimer); replayTimer = undefined; }
}
function completedReplay(): ReturnType<typeof createReplay> {
  return createReplay({ mapId: selectedMap.id, difficulty, initialState, commands: commandHistory });
}
function beginReplay(file: ReplayFile): void {
  clearReplayTimer();
  replay = { file: structuredClone(file), state: structuredClone(file.initialState), index: 0, playing: false, speed: 1 };
  selected = undefined; message = 'リプレイを読み込みました。再生ボタンで開始できます。'; render();
}
function advanceReplay(): void {
  if (!replay || replay.index >= replay.file.commands.length) {
    if (replay) replay.playing = false;
    clearReplayTimer(); render(); return;
  }
  const result = applyGameCommand(replay.state, replay.file.commands[replay.index]!);
  if (!result.ok) {
    replay.playing = false; clearReplayTimer();
    message = `リプレイを再生できません: ${result.error}`; render(); return;
  }
  replay.state = result.value; replay.index += 1;
  if (replay.index >= replay.file.commands.length) {
    replay.playing = false; clearReplayTimer(); message = 'リプレイの再生が完了しました。';
  }
  render();
}
function scheduleReplay(): void {
  clearReplayTimer();
  if (!replay?.playing || replay.index >= replay.file.commands.length) return;
  replayTimer = window.setTimeout(() => { replayTimer = undefined; advanceReplay(); scheduleReplay(); }, 1000 / replay.speed);
}
function leaveReplay(): void {
  clearReplayTimer(); replay = undefined; selected = undefined;
  message = game.winner ? '対局結果に戻りました。' : '通常の対局に戻りました。'; render();
}
function downloadReplay(): void {
  const created = completedReplay();
  if (!created.ok) { message = created.error; render(); return; }
  const serialized = serializeReplay(created.value);
  if (!serialized.ok) { message = serialized.error; render(); return; }
  const url = URL.createObjectURL(new Blob([serialized.value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `ministr-${selectedMap.id}-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  message = 'リプレイを書き出しました。'; render();
}
async function importReplay(file: File): Promise<void> {
  if (file.size > MAX_REPLAY_BYTES) { message = 'リプレイデータが大きすぎます。'; render(); return; }
  let text: string;
  try { text = await file.text(); } catch { message = 'リプレイファイルを読み込めませんでした。'; render(); return; }
  const parsed = parseReplay(text);
  if (!parsed.ok) { message = parsed.error; render(); return; }
  beginReplay(parsed.value);
}

function render(): void {
  const replayMode = replay !== undefined;
  const renderedGame = replay?.state ?? game;
  const renderedMap = maps.find(map => map.id === replay?.file.mapId) ?? selectedMap;
  const renderedDifficulty = replay?.file.difficulty ?? difficulty;
  const visible = new Set(visiblePositions(renderedGame, renderedGame.activePlayer).map(key));
  const movable = !replayMode && selected ? new Set(reachablePositions(renderedGame, selected).map(key)) : new Set<string>();
  const board = renderedGame.board.terrain.flatMap((row, y) => row.map((terrain, x) => {
    const unit = renderedGame.units.find(item => item.position.x === x && item.position.y === y);
    const hidden = renderedGame.activePlayer === 'red' && !visible.has(`${x},${y}`);
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
    return `<button ${replayMode ? 'disabled' : ''} class="tile ${terrain.kind} ${unit?.id === selected ? 'selected' : ''} ${movable.has(`${x},${y}`) ? 'reachable' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" data-terrain="${terrain.kind}" title="${propertyLabel}${unitLabel ? ` — ${unitLabel}` : ''}" aria-label="${propertyLabel}${unitLabel ? `、${unitLabel}` : ''}${status}">${facility}${label}</button>`;
  })).join('');
  const production = producibleUnits.map(kind => `<button class="produce produce-${kind}" data-kind="${kind}" ${replayMode || renderedGame.activePlayer !== 'red' ? 'disabled' : ''} title="${unitNames[kind]}を生産 (${unitStats[kind].cost}G)" aria-label="${unitNames[kind]}を${unitStats[kind].cost}ゴールドで生産"><span aria-hidden="true">${unitTokens[kind]}</span>${unitNames[kind]} <em>${unitStats[kind].cost}G</em></button>`).join('');
  const activeLabel = renderedGame.activePlayer === 'red' ? 'プレイヤー' : 'CPU';
  const selectedUnit = renderedGame.units.find(unit => unit.id === selected);
  const selectedTerrain = selectedUnit ? renderedGame.board.terrain[selectedUnit.position.y]?.[selectedUnit.position.x] : undefined;
  const canCapture = selectedUnit?.owner === renderedGame.activePlayer && selectedUnit.kind === 'infantry' && selectedTerrain && ['city', 'factory', 'capital'].includes(selectedTerrain.kind) && selectedTerrain.owner !== renderedGame.activePlayer;
  const captureAction = !replayMode && canCapture ? `<section class="capture-card"><p class="card-kicker">PROPERTY ACTION</p><strong>${terrainNames[selectedTerrain!.kind]}を占領</strong><span>${selectedTerrain!.owner === 'blue' ? '敵軍' : '中立'}拠点・占領値 ${selectedTerrain!.capturePoints ?? '—'}</span><button class="capture" id="capture" aria-label="この拠点を占領する">占領する</button></section>` : '';
  const forecasts = !replayMode && selectedUnit && selectedUnit.owner === renderedGame.activePlayer
    ? visibleEnemies(renderedGame, selectedUnit.owner).map(enemy => ({ enemy, forecast: forecastCombat(renderedGame, selectedUnit, enemy) })).filter((item): item is { enemy: typeof item.enemy; forecast: Extract<typeof item.forecast, { ok: true }> } => item.forecast.ok)
    : [];
  const forecastCard = forecasts.length > 0 ? `<section class="forecast-card"><p class="card-kicker">戦闘予測</p>${forecasts.map(({ enemy, forecast }) => `<div class="forecast-row"><span>${unitNames[enemy.kind]}（耐久 ${enemy.hp}）</span><span class="forecast-damage">与 ${forecast.value.defenderDamage}</span><span class="forecast-counter">被 ${forecast.value.canCounter ? forecast.value.counterDamage : 'なし'}</span></div>`).join('')}${selectedUnit!.hasActed ? '<p class="forecast-note">このユニットは行動済みです。</p>' : ''}</section>` : '';
  const summaryResult = !replayMode && renderedGame.winner ? summarizeReplay(initialState, commandHistory, renderedMap.id, difficulty) : undefined;
  const summary = summaryResult?.ok ? summaryResult.value : undefined;
  const gameOverOverlay = !replayMode && renderedGame.winner ? `<div class="game-over" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="game-over-card"><p class="card-kicker">RESULT</p><h2 id="result-title">${renderedGame.winner === 'red' ? 'プレイヤーの勝利' : 'CPUの勝利'}</h2>${summary ? `<dl class="result-summary"><div><dt>マップ</dt><dd>${escapeHtml(renderedMap.name)}</dd></div><div><dt>難易度</dt><dd>${difficultyNames[difficulty]}</dd></div><div><dt>勝者</dt><dd>${summary.winner === 'red' ? 'プレイヤー' : 'CPU'}</dd></div><div><dt>ターン数</dt><dd>${summary.turns}</dd></div><div><dt>プレイヤー</dt><dd>撃破 ${summary.kills.red} / 占領 ${summary.captures.red}</dd></div><div><dt>CPU</dt><dd>撃破 ${summary.kills.blue} / 占領 ${summary.captures.blue}</dd></div></dl>` : `<p class="result-error">${escapeHtml(summaryResult && !summaryResult.ok ? summaryResult.error : '対局サマリーを作成できませんでした。')}</p>`}<div class="result-actions"><button id="view-replay" class="end-turn">リプレイを見る</button><button id="export-replay" class="save-action">リプレイを書き出す</button><button id="restart" class="save-action">もう一度</button></div></div></div>` : '';
  const commander = renderedGame.activePlayer === 'red'
    ? { image: './assets/commander-red.png', alt: '赤軍司令官の肖像', title: 'RED COMMAND', label: '前線司令部' }
    : { image: './assets/commander-blue.png', alt: '青軍司令官の肖像', title: 'BLUE COMMAND', label: '敵軍司令部' };
  const mapTheme = renderedMap.id === 'canyon' ? 'desert' : '';
  app.innerHTML = `<main class="game-shell">
    <header class="command-bar"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>MiniStr</h1><p>TACTICAL COMMAND</p></div></div><label class="map-picker">戦域<select id="map" aria-label="戦域マップを選択" ${replayMode ? 'disabled' : ''}>${maps.map(map => `<option value="${map.id}" ${map.id === renderedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</select></label><label class="map-picker">難易度<select id="difficulty" aria-label="CPUの難易度を選択" ${replayMode ? 'disabled' : ''}>${(['easy', 'normal', 'hard'] as CpuDifficulty[]).map(level => `<option value="${level}" ${level === renderedDifficulty ? 'selected' : ''}>${difficultyNames[level]}</option>`).join('')}</select></label><div class="save-controls"><button id="continue" class="save-action" ${replayMode || !hasSave() ? 'disabled' : ''}>続きから</button><button id="save" class="save-action" ${replayMode ? 'disabled' : ''}>手動セーブ</button><button id="delete-save" class="save-action" ${replayMode || !hasSave() ? 'disabled' : ''}>セーブ削除</button><button id="undo" class="save-action" ${!replayMode && renderedGame.activePlayer === 'red' && undoStack.length > 0 ? '' : 'disabled'}>1手戻す</button><button id="import-replay" class="save-action" ${replayMode ? 'disabled' : ''}>JSON取込</button><input id="replay-file" class="visually-hidden" type="file" accept=".json,application/json" aria-label="JSONリプレイファイルを選択"></div><div class="turn-indicator ${renderedGame.activePlayer}"><span>${replayMode ? 'REPLAY' : 'TURN'}</span><strong>${activeLabel}</strong></div><button id="end" class="end-turn" title="現在のターンを終了" aria-label="ターンを終了する" ${replayMode ? 'disabled' : ''}>ターン終了 <span aria-hidden="true">→</span></button></header>
    ${replay ? `<section class="replay-toolbar" aria-label="リプレイ再生コントロール"><div><p class="card-kicker">REPLAY</p><strong aria-live="polite">${replay.index} / ${replay.file.commands.length} 手</strong></div><button id="replay-toggle" class="end-turn" aria-label="${replay.playing ? 'リプレイを一時停止' : 'リプレイを再生'}">${replay.playing ? '一時停止' : '再生'}</button><button id="replay-step" class="save-action" ${replay.playing || replay.index >= replay.file.commands.length ? 'disabled' : ''}>1手送り</button><label class="replay-speed">速度<select id="replay-speed" aria-label="リプレイ再生速度">${([0.5, 1, 2, 4] as const).map(speed => `<option value="${speed}" ${speed === replay!.speed ? 'selected' : ''}>${speed}x</option>`).join('')}</select></label><button id="replay-exit" class="save-action">リプレイを終了</button></section>` : ''}
    <section class="battle-layout"><div class="battlefield-wrap ${mapTheme}"><div class="battlefield-heading"><div><p>OPERATION MAP</p><h2>${escapeHtml(renderedMap.name)}</h2></div><p class="status-message" aria-live="polite">${escapeHtml(message)}</p></div><div class="board" role="grid" aria-label="${escapeHtml(renderedMap.name)}の戦術マップ" style="grid-template-columns:repeat(${renderedGame.board.width},1fr)">${board}</div><div class="map-legend" aria-label="マップ凡例"><span><i class="legend-dot reachable-dot"></i>移動可能</span><span><i class="legend-dot fog-dot"></i>未索敵</span><span><i class="legend-unit red-dot"></i>自軍</span><span><i class="legend-unit blue-dot"></i>敵軍</span><span><i class="legend-facility"></i>拠点（市・工・司）</span></div></div>
    <aside class="command-panel" aria-label="作戦情報"><section class="commander-card ${renderedGame.activePlayer}"><img src="${commander.image}" alt="${commander.alt}"><div><p>COMMANDER</p><h2>${commander.title}</h2><span>${commander.label}</span></div></section>${captureAction}${forecastCard}<section class="intel-card"><p class="card-kicker">RESOURCES</p><div class="resource-row"><span>自軍資金</span><strong>${renderedGame.players.red.gold}<small>G</small></strong></div><div class="resource-row enemy"><span>敵軍資金</span><strong>${renderedGame.players.blue.gold}<small>G</small></strong></div></section><section class="intel-card"><p class="card-kicker">RECON</p><div class="recon-count"><strong>${visibleEnemies(renderedGame, renderedGame.activePlayer).length}</strong><span>確認済み敵部隊</span></div></section><section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>ユニット生産</h2></div><div class="production-grid">${production}</div></section><p class="command-tip">歩兵は中立・敵軍の都市、工場、司令部で<strong>占領</strong>できます。拠点は毎ターン資金を供給し、工場では生産できます。</p></aside>
  </section></main>${gameOverOverlay}`;
  const guardNormal = (action: () => void) => () => { if (!replay) action(); };
  document.querySelector<HTMLSelectElement>('#map')!.onchange = guardNormal(() => { resetGame(document.querySelector<HTMLSelectElement>('#map')!.value); message = '新しい作戦を開始しました。'; render(); });
  document.querySelector<HTMLSelectElement>('#difficulty')!.onchange = guardNormal(() => { difficulty = document.querySelector<HTMLSelectElement>('#difficulty')!.value as CpuDifficulty; render(); });
  document.querySelector<HTMLButtonElement>('#end')!.onclick = guardNormal(() => { if (dispatch({ type: 'endTurn' })) { selected = undefined; undoStack = []; if (game.activePlayer === 'blue') runCpu(); } render(); });
  document.querySelector<HTMLButtonElement>('#continue')!.onclick = guardNormal(() => { continueSavedGame(); render(); });
  document.querySelector<HTMLButtonElement>('#save')!.onclick = guardNormal(() => { persist(MANUAL_SAVE_KEY); render(); });
  document.querySelector<HTMLButtonElement>('#delete-save')!.onclick = guardNormal(() => { const result = deleteSaves(localStorage); message = result.ok ? 'セーブデータを削除しました。' : result.error; render(); });
  document.querySelector<HTMLButtonElement>('#undo')!.onclick = guardNormal(() => { const checkpoint = undoStack.pop(); if (checkpoint) { game = checkpoint.state; commandHistory.length = checkpoint.commandCount; selected = undefined; message = '1手戻しました。'; } render(); });
  if (!replayMode) {
    app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => tile.onclick = () => act({ x: Number(tile.dataset.x), y: Number(tile.dataset.y) }));
    app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = () => { const factory = game.board.terrain.flatMap((row,y) => row.map((tile,x) => ({ tile,x,y }))).find(item => item.tile.kind === 'factory' && item.tile.owner === game.activePlayer); if (factory) { if (dispatch({ type: 'produce', factory: { x: factory.x, y: factory.y }, kind: button.dataset.kind as UnitKind }, true)) message = '生産しました。'; render(); } });
    document.querySelector<HTMLButtonElement>('#capture')?.addEventListener('click', guardNormal(() => {
      if (!selected) return;
      if (dispatch({ type: 'capture', unitId: selected }, true)) message = '拠点の占領を進めました。';
      render();
    }));
  }
  document.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', guardNormal(() => {
    resetGame(selectedMap.id); message = 'ユニットを選択して行動してください。'; render();
  }));
  document.querySelector<HTMLButtonElement>('#view-replay')?.addEventListener('click', guardNormal(() => {
    const created = completedReplay();
    if (!created.ok) { message = created.error; render(); return; }
    beginReplay(created.value);
  }));
  document.querySelector<HTMLButtonElement>('#export-replay')?.addEventListener('click', guardNormal(downloadReplay));
  document.querySelector<HTMLButtonElement>('#import-replay')!.onclick = guardNormal(() => document.querySelector<HTMLInputElement>('#replay-file')!.click());
  document.querySelector<HTMLInputElement>('#replay-file')!.onchange = event => {
    if (replay) return;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void importReplay(file);
  };
  document.querySelector<HTMLButtonElement>('#replay-toggle')?.addEventListener('click', () => {
    if (!replay) return;
    replay.playing = !replay.playing;
    if (replay.playing) scheduleReplay(); else clearReplayTimer();
    render();
  });
  document.querySelector<HTMLButtonElement>('#replay-step')?.addEventListener('click', () => { if (replay && !replay.playing) advanceReplay(); });
  document.querySelector<HTMLSelectElement>('#replay-speed')?.addEventListener('change', event => {
    if (!replay) return;
    replay.speed = Number((event.currentTarget as HTMLSelectElement).value) as ReplayRuntime['speed'];
    if (replay.playing) scheduleReplay();
    render();
  });
  document.querySelector<HTMLButtonElement>('#replay-exit')?.addEventListener('click', leaveReplay);
}

function act(position: Position): void { const target = game.units.find(unit => key(unit.position) === key(position)); if (target?.owner === game.activePlayer) { selected = target.id; message = `${unitNames[target.kind]}を選択しました。`; } else if (target && selected) { if (dispatch({ type: 'attack', unitId: selected, targetId: target.id }, true)) message = '攻撃しました。'; selected = undefined; } else if (selected && dispatch({ type: 'move', unitId: selected, destination: position }, true)) message = '移動しました。'; render(); }
function runCpu(): void {
  for (let steps = 0; steps < 30 && game.activePlayer === 'blue' && !game.winner; steps += 1) {
    const action = chooseCpuAction(game, difficulty);
    if (action.type === 'endTurn') { dispatch(action); break; }
    if (!dispatch(action)) { dispatch({ type: 'endTurn' }); break; }
  }
  undoStack = [];
  if (persist(AUTO_SAVE_KEY)) message = 'CPU が行動しました。オートセーブしました。';
}
render();
