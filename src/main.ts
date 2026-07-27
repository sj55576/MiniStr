import './style.css';
import { allProducibleUnitKinds, applyEditorTool, applyGameCommand, AUTO_SAVE_KEY, availableScenarios, campaignStages, canProduceUnit, createCampaignProgress, createReplay, createScenarioEditor, createScenarioInitialState, damageRange, deleteSaves, describeVictoryCondition, exportScenarioEditorJson, forecastCombat, getConditionProgress, gradeCampaignBattle, hasSavedGame, importScenarioEditorJson, isCampaignScenarioUnlocked, isDeployedUnit, isPropertyTerrainKind, loadCampaignProgress, loadCustomScenarios, loadGame, MANUAL_SAVE_KEY, maps, MAX_REPLAY_BYTES, parseReplay, reachablePositionsForPlayer, recordCampaignVictory, saveCampaignProgress, saveCustomScenario, saveGame, scenarioById, serializeReplay, summarizeReplay, validateEditorScenario, type CampaignGradeResult, type GameCommand, type GameState, type PlayerId, type Position, type ReplayFile, type ScenarioEditorState, type TerrainKind, type UnitKind, type VictoryCondition, unitStats, visibleEnemies, visiblePositions } from './game';
import { chooseCpuAction, type CpuDifficulty } from './ai';
import { nextBoardPosition } from './ui/boardNavigation';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let focusedPosition: Position = { x: 0, y: 0 };
let message = 'ユニットを選択して行動してください。';
const loadedCustomScenarios = loadCustomScenarios(localStorage);
if (!loadedCustomScenarios.ok) message = loadedCustomScenarios.error;
let difficulty: CpuDifficulty = 'normal';
let initialState = structuredClone(game);
let commandHistory: GameCommand[] = [];
let undoStack: { state: GameState; commandCount: number }[] = [];
interface ReplayRuntime { file: ReplayFile; state: GameState; index: number; playing: boolean; speed: 0.5 | 1 | 2 | 4 }
let replay: ReplayRuntime | undefined;
let replayTimer: number | undefined;
let briefingOpen = true;
let campaignMenuOpen = false;
let campaignReturnToBriefing = false;
let campaignRun: { scenarioId: string } | undefined;
let campaignOutcome: { result: CampaignGradeResult; persisted: boolean; nextScenarioId?: string } | undefined;
let editorOpen = false;
let editor: ScenarioEditorState = createScenarioEditor();
let editorNotice = '';
let focusSelector: string | undefined;
const loadedCampaign = loadCampaignProgress(localStorage);
let campaignProgress = loadedCampaign.ok ? loadedCampaign.value : createCampaignProgress();
let campaignNotice = loadedCampaign.ok ? '' : loadedCampaign.error;
const app = document.querySelector<HTMLDivElement>('#app')!;
const difficultyNames: Record<CpuDifficulty, string> = { easy: '易しい', normal: '普通', hard: '難しい' };

const terrainNames: Record<string, string> = {
  plain: '平原', forest: '森林', mountain: '山岳', road: '道路', sea: '海',
  city: '都市', factory: '工場', port: '港湾', capital: '司令部',
};
const unitTokens: Record<UnitKind, string> = {
  infantry: '歩', tank: '戦', artillery: '砲', fighter: '戦', bomber: '爆', destroyer: '艦', landingShip: '輸', recon: '偵', rocket: '自',
};
const unitNames: Record<UnitKind, string> = {
  infantry: '歩兵', tank: '戦車', artillery: '砲兵', fighter: '戦闘機', bomber: '爆撃機', destroyer: '駆逐艦', landingShip: '輸送艦', recon: '偵察車', rocket: '自走砲',
};
const producibleUnits = allProducibleUnitKinds;
const terrainKinds: readonly TerrainKind[] = ['plain', 'forest', 'road', 'mountain', 'sea', 'city', 'factory', 'port', 'capital'];
const editorVictoryKinds = ['eliminate', 'captureCapital', 'hold', 'survive', 'score'] as const;

function editorVictoryCondition(kind: typeof editorVictoryKinds[number], target: number): VictoryCondition {
  if (kind === 'eliminate' || kind === 'captureCapital') return { type: kind };
  if (kind === 'hold') return { type: 'hold', positions: [{ ...editor.selected }], turns: Math.max(1, target) };
  if (kind === 'survive') return { type: 'survive', untilTurn: Math.max(1, target) };
  return { type: 'score', target: Math.max(1, target) };
}

function setEditorVictory(kind: typeof editorVictoryKinds[number], target: number): void {
  editor = { ...editor, data: { ...editor.data, victoryConditions: [editorVictoryCondition(kind, target)] } };
}

function start(id: string): GameState {
  selectedMap = scenarioById(id) ?? maps[0]!;
  return createScenarioInitialState(selectedMap);
}

const key = (p: Position) => `${p.x},${p.y}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!);
const adjacent = (first: Position, second: Position) => Math.abs(first.x - second.x) + Math.abs(first.y - second.y) === 1;

function objectiveProgress(condition: VictoryCondition, state: GameState, player: PlayerId): string {
  const progress = getConditionProgress(state, condition, player);
  return progress.complete ? '達成' : `${progress.current} / ${progress.target}`;
}

function objectiveList(conditions: readonly VictoryCondition[], state: GameState, player: PlayerId): string {
  if (conditions.length === 0) return '<li><span>条件なし</span></li>';
  return conditions.map(condition => `<li><span>${escapeHtml(describeVictoryCondition(condition))}</span><strong>${escapeHtml(objectiveProgress(condition, state, player))}</strong></li>`).join('');
}


function resetGame(mapId: string): void {
  game = start(mapId);
  initialState = structuredClone(game);
  commandHistory = [];
  undoStack = [];
  selected = undefined;
  focusedPosition = { x: 0, y: 0 };
  briefingOpen = true;
}
function finishCampaignBattle(): void {
  if (!campaignRun || game.winner !== 'red' || campaignOutcome) return;
  const stage = campaignStages.find(candidate => candidate.scenarioId === campaignRun!.scenarioId);
  const summary = summarizeReplay(initialState, commandHistory, selectedMap.id, difficulty);
  if (!stage) { campaignNotice = 'キャンペーン作戦が見つかりません。'; return; }
  if (!summary.ok) { campaignNotice = summary.error; return; }
  const graded = gradeCampaignBattle({
    initialState, finalState: game, losses: summary.value.kills.blue,
    recommendedTurns: stage.recommendedTurns,
  });
  if (!graded.ok) { campaignNotice = graded.error; return; }
  const recorded = recordCampaignVictory(campaignProgress, stage.scenarioId, graded.value.grade);
  if (!recorded.ok) { campaignNotice = recorded.error; return; }
  const nextScenarioId = campaignStages[campaignStages.indexOf(stage) + 1]?.scenarioId;
  const saved = saveCampaignProgress(localStorage, recorded.value);
  if (saved.ok) campaignProgress = recorded.value;
  campaignOutcome = { result: graded.value, persisted: saved.ok, nextScenarioId: saved.ok ? nextScenarioId : undefined };
  campaignNotice = saved.ok ? `${graded.value.grade}評価を記録しました。` : saved.error;
}
function dispatch(command: GameCommand, undoable = false): boolean {
  if (replay) return false;
  const result = applyGameCommand(game, command);
  if (!result.ok) { message = result.error; return false; }
  if (undoable && game.activePlayer === 'red') undoStack.push({ state: game, commandCount: commandHistory.length });
  game = result.value;
  commandHistory.push(command);
  finishCampaignBattle();
  return true;
}
function persist(key: string): boolean {
  const result = saveGame(localStorage, key, {
    mapId: selectedMap.id, difficulty, initialState, commands: commandHistory, gameState: game,
    campaignScenarioId: campaignRun?.scenarioId,
  });
  message = result.ok ? 'セーブしました。' : result.error;
  return result.ok;
}
function hasSave(): boolean {
  return hasSavedGame(localStorage);
}
function continueSavedGame(): void {
  campaignRun = undefined;
  campaignOutcome = undefined;
  const loaded = loadGame(localStorage);
  if (!loaded) { message = 'セーブデータがありません。'; return; }
  if (!loaded.ok) { resetGame(selectedMap.id); message = loaded.error; return; }
  const map = scenarioById(loaded.value.mapId);
  if (!map) { resetGame(selectedMap.id); message = 'セーブデータのマップは利用できません。'; return; }
  selectedMap = map;
  difficulty = loaded.value.difficulty;
  initialState = { ...structuredClone(loaded.value.initialState), scenarioId: map.id };
  commandHistory = [...loaded.value.commands];
  game = { ...structuredClone(loaded.value.gameState), scenarioId: map.id };
  if (loaded.value.campaignScenarioId && isCampaignScenarioUnlocked(campaignProgress, loaded.value.campaignScenarioId)) {
    campaignRun = { scenarioId: loaded.value.campaignScenarioId };
  }
  finishCampaignBattle();
  undoStack = [];
  selected = undefined;
  focusedPosition = { x: 0, y: 0 };
  briefingOpen = false;
  message = 'セーブデータから再開しました。';
}

function openCampaignMenu(): void {
  campaignReturnToBriefing = briefingOpen;
  briefingOpen = false;
  campaignMenuOpen = true;
  render();
}
function startCampaignScenario(scenarioId: string): void {
  if (!isCampaignScenarioUnlocked(campaignProgress, scenarioId)) {
    campaignNotice = 'この作戦はまだ解放されていません。';
    render();
    return;
  }
  campaignRun = { scenarioId };
  campaignOutcome = undefined;
  campaignMenuOpen = false;
  resetGame(scenarioId);
  message = '作戦ブリーフィングを確認してください。';
  render();
}


function clearReplayTimer(): void {
  if (replayTimer !== undefined) { window.clearTimeout(replayTimer); replayTimer = undefined; }
}
function completedReplay(): ReturnType<typeof createReplay> {
  return createReplay({ mapId: selectedMap.id, difficulty, initialState, commands: commandHistory });
}
function beginReplay(file: ReplayFile): void {
  clearReplayTimer();
  replay = { file: structuredClone(file), state: { ...structuredClone(file.initialState), scenarioId: file.mapId }, index: 0, playing: false, speed: 1 };
  selected = undefined; briefingOpen = false; message = 'リプレイを読み込みました。再生ボタンで開始できます。'; render();
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
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && app.contains(activeElement)) {
    if (activeElement.id) focusSelector = `#${activeElement.id}`;
    else if (activeElement.matches('.produce[data-kind]')) focusSelector = `.produce[data-kind="${activeElement.dataset.kind}"]`;
    else if (activeElement.matches('.tile[data-x][data-y]')) focusSelector = `.tile[data-x="${activeElement.dataset.x}"][data-y="${activeElement.dataset.y}"]`;
  }
  const replayMode = replay !== undefined;
  const renderedGame = replay?.state ?? game;
  const renderedMap = scenarioById(replay?.file.mapId) ?? selectedMap;
  const renderedDifficulty = replay?.file.difficulty ?? difficulty;
  const visible = new Set(visiblePositions(renderedGame, 'red').map(key));
  const movable = !replayMode && selected ? new Set(reachablePositionsForPlayer(renderedGame, selected, 'red').map(key)) : new Set<string>();
  const board = renderedGame.board.terrain.flatMap((row, y) => row.map((terrain, x) => {
    const unit = renderedGame.units.find(item => isDeployedUnit(item) && item.position.x === x && item.position.y === y);
    const hidden = !visible.has(`${x},${y}`);
    const terrainName = terrainNames[terrain.kind] ?? terrain.kind;
    const isProperty = isPropertyTerrainKind(terrain.kind);
    const propertyOwner = isProperty ? terrain.owner : undefined;
    const capturePoints = isProperty ? terrain.capturePoints : undefined;
    const facilityDetail = terrain.kind === 'port' ? '、補給・駆逐艦・輸送艦を生産可能' : terrain.kind === 'factory' ? '、補給・ユニット生産拠点' : '';
    const propertyLabel = isProperty ? `${terrainName}${propertyOwner ? `（${propertyOwner === 'red' ? '自軍' : '敵軍'}）` : '（中立）'}${capturePoints !== undefined ? `、占領値 ${capturePoints}` : ''}${facilityDetail}` : terrainName;
    const cargo = unit?.kind === 'landingShip' ? renderedGame.units.find(candidate => candidate.embarkedIn === unit.id) : undefined;
    const unitLabel = unit && !hidden ? `${unit.owner === 'red' ? 'プレイヤー' : 'CPU'}の${unitNames[unit.kind]}、耐久 ${unit.hp}${cargo ? `、搭載 ${unitNames[cargo.kind]}` : ''}` : '';
    const label = unit && !hidden
      ? `<span class="unit ${unit.owner} unit-${unit.kind}" aria-hidden="true"><b>${unitTokens[unit.kind]}</b><small>${unit.hp}</small><em>${unitNames[unit.kind]}${cargo ? `・${unitNames[cargo.kind]}搭載` : ''}</em><i class="unit-owner-marker">${unit.owner === 'red' ? '自' : '敵'}</i>${cargo ? '<i class="cargo-marker">積</i>' : ''}</span>`
      : '';
    const facility = isProperty && !hidden
      ? `<span class="facility facility-${terrain.kind} ${propertyOwner ?? 'neutral'}" aria-hidden="true"><b>${terrain.kind === 'city' ? '市' : terrain.kind === 'factory' ? '工' : terrain.kind === 'port' ? '港' : '司'}</b><small>${propertyOwner === 'red' ? '自軍' : propertyOwner === 'blue' ? '敵軍' : '中立'}${capturePoints !== undefined ? ` ${capturePoints}` : ''}</small></span>`
      : '';
    const isSelected = unit?.id === selected;
    const isReachable = movable.has(`${x},${y}`);
    const status = `${isSelected ? '、選択中' : ''}${isReachable ? '、移動可能' : hidden ? '、未索敵' : ''}`;
    const stateMarker = isSelected ? '<span class="tile-state-marker selected-marker" aria-hidden="true">選</span>' : isReachable ? '<span class="tile-state-marker reachable-marker" aria-hidden="true">移</span>' : '';
    return `<button ${replayMode || renderedGame.activePlayer !== 'red' ? 'disabled' : ''} class="tile ${terrain.kind} ${isSelected ? 'selected' : ''} ${isReachable ? 'reachable' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" data-terrain="${terrain.kind}" tabindex="${focusedPosition.x === x && focusedPosition.y === y ? '0' : '-1'}" title="${propertyLabel}${unitLabel ? ` — ${unitLabel}` : ''}" aria-label="${propertyLabel}${unitLabel ? `、${unitLabel}` : ''}${status}">${stateMarker}${facility}${label}</button>`;
  })).join('');
  const production = producibleUnits.map(kind => {
    const hasFacility = renderedGame.board.terrain.some((row, y) => row.some((tile, x) =>
      tile.owner === renderedGame.activePlayer && canProduceUnit(tile.kind, kind)
      && !renderedGame.units.some(unit => isDeployedUnit(unit) && unit.position.x === x && unit.position.y === y)));
    const facilityName = kind === 'destroyer' || kind === 'landingShip' ? '港湾' : '工場';
    return `<button class="produce produce-${kind}" data-kind="${kind}" ${replayMode || renderedGame.activePlayer !== 'red' || !hasFacility ? 'disabled' : ''} title="${facilityName}で${unitNames[kind]}を生産 (${unitStats[kind].cost}G)" aria-label="${facilityName}で${unitNames[kind]}を${unitStats[kind].cost}ゴールドで生産"><span aria-hidden="true">${unitTokens[kind]}</span>${unitNames[kind]} <em>${unitStats[kind].cost}G</em></button>`;
  }).join('');
  const activeLabel = renderedGame.activePlayer === 'red' ? 'プレイヤー' : 'CPU';
  const selectedUnit = renderedGame.units.find(unit => unit.id === selected);
  const selectedTerrain = selectedUnit && isDeployedUnit(selectedUnit) ? renderedGame.board.terrain[selectedUnit.position.y]?.[selectedUnit.position.x] : undefined;
  const canCapture = selectedUnit?.owner === renderedGame.activePlayer && selectedUnit.kind === 'infantry' && selectedTerrain && isPropertyTerrainKind(selectedTerrain.kind) && selectedTerrain.owner !== renderedGame.activePlayer;
  const captureAction = !replayMode && canCapture ? `<section class="capture-card"><p class="card-kicker">PROPERTY ACTION</p><strong>${terrainNames[selectedTerrain!.kind]}を占領</strong><span>${selectedTerrain!.owner === 'blue' ? '敵軍' : '中立'}拠点・占領値 ${selectedTerrain!.capturePoints ?? '—'}</span><button class="capture" id="capture" aria-label="この拠点を占領する">占領する</button></section>` : '';
  const embarkTargets = selectedUnit?.owner === renderedGame.activePlayer && selectedUnit.kind === 'infantry' && isDeployedUnit(selectedUnit) && !selectedUnit.hasActed
    ? renderedGame.units.filter((unit) => isDeployedUnit(unit) && unit.kind === 'landingShip' && unit.owner === selectedUnit.owner
      && !unit.hasMoved && !unit.hasActed && adjacent(selectedUnit.position, unit.position)
      && !renderedGame.units.some(candidate => candidate.embarkedIn === unit.id))
    : [];
  const cargo = selectedUnit?.kind === 'landingShip' ? renderedGame.units.find(unit => unit.embarkedIn === selectedUnit.id) : undefined;
  const landingTargets = selectedUnit?.owner === renderedGame.activePlayer && selectedUnit.kind === 'landingShip' && isDeployedUnit(selectedUnit)
    && !selectedUnit.hasMoved && !selectedUnit.hasActed && cargo
    ? [{ x: selectedUnit.position.x + 1, y: selectedUnit.position.y }, { x: selectedUnit.position.x - 1, y: selectedUnit.position.y }, { x: selectedUnit.position.x, y: selectedUnit.position.y + 1 }, { x: selectedUnit.position.x, y: selectedUnit.position.y - 1 }]
      .filter(position => {
        const terrain = renderedGame.board.terrain[position.y]?.[position.x];
        return terrain?.kind !== undefined && terrain.kind !== 'sea' && !renderedGame.units.some(unit => isDeployedUnit(unit) && key(unit.position) === key(position));
      })
    : [];
  const transportAction = !replayMode && (embarkTargets.length || cargo)
    ? `<section class="transport-card"><p class="card-kicker">LANDING OPERATION</p><strong>${cargo ? `${unitNames[cargo.kind]}を搭載中` : '輸送艦への乗船'}</strong><span>${cargo ? '隣接する陸地を選んで上陸させます。' : '隣接する空の輸送艦を選んで乗船させます。'}</span>${embarkTargets.map(unit => `<button class="transport-action embark" data-transport-id="${unit.id}">${unitNames[unit.kind]}に乗船</button>`).join('')}${landingTargets.map(position => `<button class="transport-action disembark" data-x="${position.x}" data-y="${position.y}">(${position.x + 1}, ${position.y + 1}) に上陸</button>`).join('')}${cargo && landingTargets.length === 0 ? '<em class="transport-note">上陸できる隣接陸地がありません。</em>' : ''}</section>`
    : '';
  const forecasts = !replayMode && selectedUnit && selectedUnit.owner === renderedGame.activePlayer
    ? visibleEnemies(renderedGame, selectedUnit.owner).map(enemy => ({ enemy, forecast: forecastCombat(renderedGame, selectedUnit, enemy) })).filter((item): item is { enemy: typeof item.enemy; forecast: Extract<typeof item.forecast, { ok: true }> } => item.forecast.ok)
    : [];
  const forecastCard = forecasts.length > 0 ? `<section class="forecast-card"><p class="card-kicker">戦闘予測</p>${forecasts.map(({ enemy, forecast }) => {
    const outgoing = damageRange(forecast.value.damageToDefender);
    const incoming = forecast.value.canCounter ? damageRange(forecast.value.damageToAttacker) : undefined;
    return `<div class="forecast-row"><span>${unitNames[enemy.kind]}（耐久 ${enemy.hp}）</span><span class="forecast-damage">与 ${outgoing.min}〜${outgoing.max}</span><span class="forecast-counter">被 ${incoming ? `${incoming.min}〜${incoming.max}` : 'なし'}</span></div>`;
  }).join('')}${selectedUnit!.hasActed ? '<p class="forecast-note">このユニットは行動済みです。</p>' : ''}</section>` : '';
  const summaryResult = !replayMode && renderedGame.winner ? summarizeReplay(initialState, commandHistory, renderedMap.id, difficulty) : undefined;
  const summary = summaryResult?.ok ? summaryResult.value : undefined;
  const campaignResult = campaignRun && campaignOutcome
    ? `<section class="campaign-result"><span class="campaign-grade grade-${campaignOutcome.result.grade.toLowerCase()}">${campaignOutcome.result.grade}</span><div><strong>作戦評価</strong><p>${campaignOutcome.result.score}点・残存 ${campaignOutcome.result.survivingUnits}部隊・損失 ${campaignOutcome.result.losses}部隊</p>${campaignOutcome.persisted ? '' : `<p class="campaign-save-error">${escapeHtml(campaignNotice)}</p>`}</div></section>`
    : '';
  const campaignResultActions = campaignRun
    ? `<button id="campaign-retry" class="save-action">再挑戦</button><button id="campaign-back" class="save-action">キャンペーンへ戻る</button>${campaignOutcome?.nextScenarioId ? '<button id="campaign-next" class="end-turn">次の戦場へ</button>' : ''}`
    : '<button id="restart" class="save-action">もう一度</button>';
  const gameOverOverlay = !campaignMenuOpen && !replayMode && renderedGame.winner ? `<div class="game-over" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="game-over-card"><p class="card-kicker">RESULT</p><h2 id="result-title">${renderedGame.winner === 'red' ? 'プレイヤーの勝利' : 'CPUの勝利'}</h2>${summary ? `<dl class="result-summary"><div><dt>マップ</dt><dd>${escapeHtml(renderedMap.name)}</dd></div><div><dt>難易度</dt><dd>${difficultyNames[difficulty]}</dd></div><div><dt>勝者</dt><dd>${summary.winner === 'red' ? 'プレイヤー' : 'CPU'}</dd></div><div><dt>ターン数</dt><dd>${summary.turns}</dd></div><div><dt>プレイヤー</dt><dd>撃破 ${summary.kills.red} / 占領 ${summary.captures.red}</dd></div><div><dt>CPU</dt><dd>撃破 ${summary.kills.blue} / 占領 ${summary.captures.blue}</dd></div></dl>` : `<p class="result-error">${escapeHtml(summaryResult && !summaryResult.ok ? summaryResult.error : '対局サマリーを作成できませんでした。')}</p>`}${campaignResult}<div class="result-actions"><button id="view-replay" class="save-action">リプレイを見る</button><button id="export-replay" class="save-action">リプレイを書き出す</button>${campaignResultActions}</div></div></div>` : '';
  const commander = renderedGame.activePlayer === 'red'
    ? { image: './assets/commander-red.png', alt: '赤軍司令官の肖像', title: 'RED COMMAND', label: '前線司令部' }
    : { image: './assets/commander-blue.png', alt: '青軍司令官の肖像', title: 'BLUE COMMAND', label: '敵軍司令部' };
  const mapTheme = renderedMap.id === 'canyon' ? 'desert' : '';
  const remainingTurns = renderedMap.turnLimit === undefined ? undefined : Math.max(0, renderedMap.turnLimit - renderedGame.turn);
  const objectivePanel = `<section class="objective-card" aria-labelledby="objective-title"><div class="objective-heading"><div><p class="card-kicker">MISSION</p><h2 id="objective-title">作戦目標</h2></div>${remainingTurns === undefined ? `<span class="turn-limit unlimited">制限なし</span>` : `<span class="turn-limit"><strong>${remainingTurns}</strong> 残りターン</span>`}</div><div class="objective-group victory"><h3>勝利条件</h3><ul>${objectiveList(renderedMap.victoryConditions, renderedGame, 'red')}</ul></div><div class="objective-group defeat"><h3>敗北条件</h3><ul>${objectiveList(renderedMap.defeatConditions, renderedGame, 'blue')}</ul></div></section>`;
  const campaignCards = campaignStages.map((stage, index) => {
    const map = maps.find(candidate => candidate.id === stage.scenarioId)!;
    const unlocked = isCampaignScenarioUnlocked(campaignProgress, stage.scenarioId);
    const grade = campaignProgress.bestGrades[stage.scenarioId];
    return `<article class="campaign-stage ${unlocked ? '' : 'locked'}"><div class="campaign-stage-number">0${index + 1}</div><div><p class="card-kicker">${grade ? 'CLEARED' : unlocked ? 'OPEN' : 'LOCKED'}</p><h3>${escapeHtml(map.name)}</h3><p>${escapeHtml(map.briefing)}</p><span>推奨 ${stage.recommendedTurns} ターン</span></div>${grade ? `<strong class="campaign-grade grade-${grade.toLowerCase()}">${grade}</strong>` : ''}<button class="save-action campaign-start" data-campaign-id="${stage.scenarioId}" ${unlocked ? '' : 'disabled'}>${grade ? '再出撃' : '作戦開始'}</button></article>`;
  }).join('');
  const campaignOverlay = campaignMenuOpen ? `<div class="campaign-overlay" role="dialog" aria-modal="true" aria-labelledby="campaign-title"><section class="campaign-screen"><div class="campaign-heading"><div><p class="card-kicker">MINI CAMPAIGN</p><h2 id="campaign-title">国境戦役</h2><p>4つの戦場を勝ち抜き、最高評価を目指してください。</p></div><div class="campaign-heading-actions"><button id="campaign-skirmish" class="save-action">単体戦へ</button><button id="campaign-close" class="save-action">閉じる</button></div></div>${campaignNotice ? `<p class="campaign-notice" aria-live="polite">${escapeHtml(campaignNotice)}</p>` : ''}<div class="campaign-grid">${campaignCards}</div></section></div>` : '';
  const editorVictory = editor.data.victoryConditions[0] ?? { type: 'captureCapital' as const };
  const editorVictoryTarget = editorVictory.type === 'hold' ? editorVictory.turns : editorVictory.type === 'survive' ? editorVictory.untilTurn : editorVictory.type === 'score' ? editorVictory.target : 1;
  const editorBoard = Array.from({ length: editor.data.board.height }, (_, y) => Array.from({ length: editor.data.board.width }, (_, x) => {
    const cell = editor.data.board.cells.find(([cellX, cellY]) => cellX === x && cellY === y);
    const terrain = cell?.[2] ?? 'plain';
    const owner = cell?.[3];
    const unit = editor.data.initialUnits.find(candidate => candidate.x === x && candidate.y === y);
    const ownerLabel = owner === 'red' ? '自' : owner === 'blue' ? '敵' : '';
    return `<button class="editor-tile ${terrain} ${editor.selected.x === x && editor.selected.y === y ? 'selected' : ''}" data-editor-x="${x}" data-editor-y="${y}" title="(${x + 1}, ${y + 1}) ${terrainNames[terrain]}${ownerLabel ? `・${ownerLabel}` : ''}${unit ? `・${unitNames[unit.kind]}` : ''}" aria-label="(${x + 1}, ${y + 1}) ${terrainNames[terrain]}${unit ? `、${unitNames[unit.kind]}` : ''}"><span>${terrain === 'plain' ? '' : terrain === 'forest' ? '森' : terrain === 'mountain' ? '山' : terrain === 'sea' ? '海' : terrain === 'road' ? '道' : terrain === 'city' ? '市' : terrain === 'factory' ? '工' : terrain === 'port' ? '港' : '司'}</span><i>${ownerLabel}</i>${unit ? `<b class="${unit.owner}">${unitTokens[unit.kind]}</b>` : ''}</button>`;
  }).join('')).join('');
  const editorOverlay = editorOpen ? `<div class="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="editor-title"><section class="editor-screen"><div class="editor-heading"><div><p class="card-kicker">SCENARIO EDITOR</p><h2 id="editor-title">最小マップエディタ</h2><p>盤面を選択し、地形・拠点所有者・初期ユニット・勝利条件を設定します。JSONは既存の検証器で確認されます。</p></div><button id="editor-close" class="save-action">閉じる</button></div><div class="editor-layout"><section class="editor-workspace"><div class="editor-toolbar"><label>編集<select id="editor-tool"><option value="terrain" ${editor.tool === 'terrain' ? 'selected' : ''}>地形・拠点</option><option value="unit" ${editor.tool === 'unit' ? 'selected' : ''}>初期ユニット</option><option value="eraseUnit" ${editor.tool === 'eraseUnit' ? 'selected' : ''}>ユニット削除</option></select></label><label>地形<select id="editor-terrain">${terrainKinds.map(kind => `<option value="${kind}" ${kind === editor.terrain ? 'selected' : ''}>${terrainNames[kind]}</option>`).join('')}</select></label><label>所有者<select id="editor-owner"><option value="">中立 / なし</option><option value="red" ${editor.owner === 'red' ? 'selected' : ''}>自軍</option><option value="blue" ${editor.owner === 'blue' ? 'selected' : ''}>敵軍</option></select></label><label>ユニット<select id="editor-unit-kind">${(Object.keys(unitNames) as UnitKind[]).map(kind => `<option value="${kind}" ${kind === editor.unitKind ? 'selected' : ''}>${unitNames[kind]}</option>`).join('')}</select></label><label>陣営<select id="editor-unit-owner"><option value="red" ${editor.unitOwner === 'red' ? 'selected' : ''}>自軍</option><option value="blue" ${editor.unitOwner === 'blue' ? 'selected' : ''}>敵軍</option></select></label></div><div class="editor-board" style="grid-template-columns:repeat(${editor.data.board.width},1fr)">${editorBoard}</div><p class="editor-coordinates">選択中: (${editor.selected.x + 1}, ${editor.selected.y + 1})</p></section><section class="editor-fields"><label>ID<input id="editor-id" value="${escapeHtml(editor.data.id)}"></label><label>作戦名<input id="editor-name" value="${escapeHtml(editor.data.name)}"></label><label>概要<textarea id="editor-briefing">${escapeHtml(editor.data.briefing)}</textarea></label><label>開始資金<input id="editor-gold" type="number" min="0" value="${editor.data.startingGold}"></label><label>勝利条件<select id="editor-victory">${editorVictoryKinds.map(kind => `<option value="${kind}" ${editorVictory.type === kind ? 'selected' : ''}>${kind === 'eliminate' ? '敵軍を全滅' : kind === 'captureCapital' ? '敵司令部を占領' : kind === 'hold' ? '選択地点を保持' : kind === 'survive' ? '規定ターン生存' : 'スコア到達'}</option>`).join('')}</select></label><label>目標値<input id="editor-victory-target" type="number" min="1" value="${editorVictoryTarget}"></label><p class="editor-hint">「保持」は現在選択中のマスを目標にします。敗北条件は敵の司令部占領です。</p></section></div><section class="editor-json"><div><h3>JSON 入出力</h3><p>読み込み時・検証時ともに、通常のシナリオと同じ安全なバリデーションを使います。</p></div><textarea id="editor-json" aria-label="シナリオJSON">${escapeHtml(exportScenarioEditorJson(editor))}</textarea><div class="editor-actions"><button id="editor-export" class="save-action">JSONを書き出す</button><button id="editor-import" class="save-action">JSONを反映</button><button id="editor-validate" class="end-turn">シナリオを検証</button><button id="editor-start" class="end-turn">保存してこのシナリオで開始</button></div>${editorNotice ? `<p class="editor-notice" aria-live="polite">${escapeHtml(editorNotice)}</p>` : ''}</section></section></div>` : '';
  const briefing = !campaignMenuOpen && !replayMode && briefingOpen ? `<div class="briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title" aria-describedby="briefing-copy"><section class="briefing-card"><p class="card-kicker">OPERATION BRIEFING</p><h2 id="briefing-title">${escapeHtml(renderedMap.name)}</h2><p id="briefing-copy" class="briefing-copy">${escapeHtml(renderedMap.briefing)}</p><div class="briefing-objectives"><section><h3>勝利条件</h3><ul>${renderedMap.victoryConditions.map(condition => `<li>${escapeHtml(describeVictoryCondition(condition))}</li>`).join('')}</ul></section><section><h3>敗北条件</h3><ul>${renderedMap.defeatConditions.map(condition => `<li>${escapeHtml(describeVictoryCondition(condition))}</li>`).join('')}</ul></section></div><div class="briefing-meta"><span>初期資金 <strong>${renderedMap.startingGold}G</strong></span><span>ターン制限 <strong>${renderedMap.turnLimit ?? 'なし'}</strong></span><span>難易度 <strong>${difficultyNames[difficulty]}</strong></span></div><div class="briefing-actions"><button id="open-campaign-briefing" class="save-action">キャンペーン</button><button id="begin-operation" class="end-turn">${campaignRun ? '作戦開始' : '単体作戦を開始'} <span aria-hidden="true">→</span></button></div></section></div>` : '';
  app.innerHTML = `<main class="game-shell">
    <header class="command-bar"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>MiniStr</h1><p>TACTICAL COMMAND</p></div></div><label class="map-picker">戦域<select id="map" aria-label="戦域マップを選択" ${replayMode || campaignRun ? 'disabled' : ''}><optgroup label="組み込み">${maps.map(map => `<option value="${map.id}" ${map.id === renderedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</optgroup>${availableScenarios().filter(map => !maps.some(builtIn => builtIn.id === map.id)).length ? `<optgroup label="カスタム">${availableScenarios().filter(map => !maps.some(builtIn => builtIn.id === map.id)).map(map => `<option value="${map.id}" ${map.id === renderedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</optgroup>` : ''}</select></label><label class="map-picker">難易度<select id="difficulty" aria-label="CPUの難易度を選択" ${replayMode ? 'disabled' : ''}>${(['easy', 'normal', 'hard'] as CpuDifficulty[]).map(level => `<option value="${level}" ${level === renderedDifficulty ? 'selected' : ''}>${difficultyNames[level]}</option>`).join('')}</select></label><div class="save-controls"><button id="open-editor" class="save-action" ${replayMode ? 'disabled' : ''}>マップ編集</button><button id="open-campaign" class="save-action" ${replayMode ? 'disabled' : ''}>キャンペーン</button><button id="continue" class="save-action" ${replayMode || !hasSave() ? 'disabled' : ''}>続きから</button><button id="save" class="save-action" ${replayMode ? 'disabled' : ''}>手動セーブ</button><button id="delete-save" class="save-action" ${replayMode || !hasSave() ? 'disabled' : ''}>対局セーブ削除</button><button id="undo" class="save-action" ${!replayMode && renderedGame.activePlayer === 'red' && undoStack.length > 0 ? '' : 'disabled'}>1手戻す</button><button id="import-replay" class="save-action" ${replayMode ? 'disabled' : ''}>JSON取込</button><input id="replay-file" class="visually-hidden" type="file" accept=".json,application/json" aria-label="JSONリプレイファイルを選択"></div><div class="turn-indicator ${renderedGame.activePlayer}"><span>${replayMode ? 'REPLAY' : campaignRun ? 'CAMPAIGN' : 'TURN'}</span><strong>${activeLabel}</strong></div><button id="end" class="end-turn" title="現在のターンを終了" aria-label="ターンを終了する" ${replayMode ? 'disabled' : ''}>ターン終了 <span aria-hidden="true">→</span></button></header>
    ${replay ? `<section class="replay-toolbar" aria-label="リプレイ再生コントロール"><div><p class="card-kicker">REPLAY</p><strong aria-live="polite">${replay.index} / ${replay.file.commands.length} 手</strong></div><button id="replay-toggle" class="end-turn" aria-label="${replay.playing ? 'リプレイを一時停止' : replay.index >= replay.file.commands.length ? 'リプレイを最初から再生' : 'リプレイを再生'}" ${replay.file.commands.length === 0 ? 'disabled' : ''}>${replay.playing ? '一時停止' : replay.index >= replay.file.commands.length ? 'もう一度再生' : '再生'}</button><button id="replay-step" class="save-action" ${replay.playing || replay.index >= replay.file.commands.length ? 'disabled' : ''}>1手送り</button><label class="replay-speed">速度<select id="replay-speed" aria-label="リプレイ再生速度">${([0.5, 1, 2, 4] as const).map(speed => `<option value="${speed}" ${speed === replay!.speed ? 'selected' : ''}>${speed}x</option>`).join('')}</select></label><button id="replay-exit" class="save-action">リプレイを終了</button></section>` : ''}
    <section class="battle-layout"><div class="battlefield-wrap ${mapTheme}"><div class="battlefield-heading"><div><p>OPERATION MAP</p><h2>${escapeHtml(renderedMap.name)}</h2></div><p class="status-message" aria-live="polite">${escapeHtml(message)}</p></div><p id="board-instructions" class="board-instructions">盤面では矢印キーでマスを移動し、Enter または Space で選択・行動、Esc で選択を解除できます。</p><div class="board" role="group" aria-label="${escapeHtml(renderedMap.name)}の戦術マップ" aria-describedby="board-instructions" style="grid-template-columns:repeat(${renderedGame.board.width},1fr)">${board}</div><div class="map-legend" aria-label="マップ凡例"><span><i class="legend-dot reachable-dot" aria-hidden="true">移</i>移動可能</span><span><i class="legend-dot fog-dot" aria-hidden="true">?</i>未索敵</span><span><i class="legend-unit red-dot" aria-hidden="true">自</i>自軍</span><span><i class="legend-unit blue-dot" aria-hidden="true">敵</i>敵軍</span><span><i class="legend-facility" aria-hidden="true">拠</i>拠点（市・工・港・司）</span></div></div>
    <aside id="command-panel" class="command-panel" aria-label="作戦情報" tabindex="-1">${objectivePanel}<section class="commander-card ${renderedGame.activePlayer}"><img src="${commander.image}" alt="${commander.alt}"><div><p>COMMANDER</p><h2>${commander.title}</h2><span>${commander.label}</span></div></section>${captureAction}${transportAction}${forecastCard}<section class="intel-card"><p class="card-kicker">RESOURCES</p><div class="resource-row"><span>自軍資金</span><strong>${renderedGame.players.red.gold}<small>G</small></strong></div><div class="resource-row enemy"><span>敵軍資金</span><strong>${renderedGame.players.blue.gold}<small>G</small></strong></div></section><section class="intel-card"><p class="card-kicker">RECON</p><div class="recon-count"><strong>${visibleEnemies(renderedGame, 'red').length}</strong><span>確認済み敵部隊</span></div></section><section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>ユニット生産</h2></div><div class="production-grid">${production}</div></section><p class="command-tip">歩兵は中立・敵軍の都市、工場、港湾、司令部で<strong>占領</strong>できます。輸送艦は歩兵を1部隊搭載し、別の島へ上陸させられます。</p></aside>
  </section></main>${gameOverOverlay}${briefing}${campaignOverlay}${editorOverlay}`;
  if (briefing || campaignOverlay || editorOverlay) {
    app.querySelector('main')?.setAttribute('inert', '');
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(editorOverlay ? '#editor-close' : campaignOverlay ? '#campaign-close' : '#begin-operation')?.focus(), 0);
  }
  else if (focusSelector) {
    const previousSelector = focusSelector;
    focusSelector = undefined;
    window.requestAnimationFrame(() => {
      const target = app.querySelector<HTMLElement>(previousSelector);
      (target && !('disabled' in target && target.disabled) ? target : app.querySelector<HTMLElement>('#command-panel'))?.focus();
    });
  }
  const guardNormal = (action: () => void) => () => { if (!replay && game.activePlayer === 'red') action(); };
  document.querySelector<HTMLSelectElement>('#map')!.onchange = guardNormal(() => {
    campaignRun = undefined; campaignOutcome = undefined;
    resetGame(document.querySelector<HTMLSelectElement>('#map')!.value);
    message = '作戦ブリーフィングを確認してください。'; render();
  });
  document.querySelector<HTMLSelectElement>('#difficulty')!.onchange = guardNormal(() => { difficulty = document.querySelector<HTMLSelectElement>('#difficulty')!.value as CpuDifficulty; render(); });
  document.querySelector<HTMLButtonElement>('#end')!.onclick = guardNormal(() => { if (dispatch({ type: 'endTurn' })) { selected = undefined; undoStack = []; if (game.activePlayer === 'blue') runCpu(); } render(); });
  document.querySelector<HTMLButtonElement>('#continue')!.onclick = guardNormal(() => { continueSavedGame(); render(); });
  document.querySelector<HTMLButtonElement>('#save')!.onclick = guardNormal(() => { persist(MANUAL_SAVE_KEY); render(); });
  document.querySelector<HTMLButtonElement>('#delete-save')!.onclick = guardNormal(() => { const result = deleteSaves(localStorage); message = result.ok ? 'セーブデータを削除しました。' : result.error; render(); });
  document.querySelector<HTMLButtonElement>('#undo')!.onclick = guardNormal(() => { const checkpoint = undoStack.pop(); if (checkpoint) { game = checkpoint.state; commandHistory.length = checkpoint.commandCount; selected = undefined; message = '1手戻しました。'; } render(); });
  document.querySelector<HTMLButtonElement>('#open-editor')?.addEventListener('click', guardNormal(() => {
    editorOpen = true; editorNotice = '編集したシナリオはJSONとして書き出せます。'; render();
  }));
  document.querySelector<HTMLButtonElement>('#editor-close')?.addEventListener('click', () => { editorOpen = false; render(); });
  if (editorOpen) {
    const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector: string) => app.querySelector<T>(selector)!;
    field<HTMLSelectElement>('#editor-tool').onchange = () => { editor = { ...editor, tool: field<HTMLSelectElement>('#editor-tool').value as ScenarioEditorState['tool'] }; };
    field<HTMLSelectElement>('#editor-terrain').onchange = () => { editor = { ...editor, terrain: field<HTMLSelectElement>('#editor-terrain').value as TerrainKind }; };
    field<HTMLSelectElement>('#editor-owner').onchange = () => { const value = field<HTMLSelectElement>('#editor-owner').value; editor = { ...editor, owner: value === '' ? undefined : value as PlayerId }; };
    field<HTMLSelectElement>('#editor-unit-kind').onchange = () => { editor = { ...editor, unitKind: field<HTMLSelectElement>('#editor-unit-kind').value as UnitKind }; };
    field<HTMLSelectElement>('#editor-unit-owner').onchange = () => { editor = { ...editor, unitOwner: field<HTMLSelectElement>('#editor-unit-owner').value as PlayerId }; };
    field<HTMLInputElement>('#editor-id').oninput = () => { editor = { ...editor, data: { ...editor.data, id: field<HTMLInputElement>('#editor-id').value } }; };
    field<HTMLInputElement>('#editor-name').oninput = () => { editor = { ...editor, data: { ...editor.data, name: field<HTMLInputElement>('#editor-name').value } }; };
    field<HTMLTextAreaElement>('#editor-briefing').oninput = () => { editor = { ...editor, data: { ...editor.data, briefing: field<HTMLTextAreaElement>('#editor-briefing').value } }; };
    field<HTMLInputElement>('#editor-gold').oninput = () => { editor = { ...editor, data: { ...editor.data, startingGold: Number(field<HTMLInputElement>('#editor-gold').value) } }; };
    const updateVictory = () => setEditorVictory(field<HTMLSelectElement>('#editor-victory').value as typeof editorVictoryKinds[number], Number(field<HTMLInputElement>('#editor-victory-target').value));
    field<HTMLSelectElement>('#editor-victory').onchange = updateVictory;
    field<HTMLInputElement>('#editor-victory-target').oninput = updateVictory;
    app.querySelectorAll<HTMLButtonElement>('.editor-tile').forEach(tile => tile.addEventListener('click', () => {
      editor = applyEditorTool(editor, { x: Number(tile.dataset.editorX), y: Number(tile.dataset.editorY) });
      editorNotice = '盤面を更新しました。'; render();
    }));
    document.querySelector<HTMLButtonElement>('#editor-export')?.addEventListener('click', () => {
      field<HTMLTextAreaElement>('#editor-json').value = exportScenarioEditorJson(editor);
      editorNotice = 'JSONを書き出しました。';
    });
    document.querySelector<HTMLButtonElement>('#editor-import')?.addEventListener('click', () => {
      const imported = importScenarioEditorJson(field<HTMLTextAreaElement>('#editor-json').value, editor);
      if (imported.ok) { editor = imported.value; editorNotice = 'JSONを反映しました。'; }
      else editorNotice = imported.error;
      render();
    });
    document.querySelector<HTMLButtonElement>('#editor-validate')?.addEventListener('click', () => {
      const result = validateEditorScenario(editor);
      editorNotice = result.ok ? '検証に成功しました。JSONはゲームに取り込める形式です。' : result.error;
      render();
    });
    document.querySelector<HTMLButtonElement>('#editor-start')?.addEventListener('click', () => {
      const saved = saveCustomScenario(localStorage, editor.data);
      if (!saved.ok) { editorNotice = saved.error; render(); return; }
      campaignRun = undefined;
      campaignOutcome = undefined;
      editorOpen = false;
      resetGame(saved.value.id);
      message = 'カスタムシナリオを保存して開始しました。';
      render();
    });
  }
  if (!replayMode) {
    app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => {
      const position = { x: Number(tile.dataset.x), y: Number(tile.dataset.y) };
      tile.onclick = () => { focusedPosition = position; act(position); focusBoardPosition(focusedPosition); };
      tile.onkeydown = event => handleBoardKey(event, position);
    });
    app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = () => {
      const kind = button.dataset.kind as UnitKind;
      const facility = game.board.terrain.flatMap((row, y) => row.map((tile, x) => ({ tile, x, y })))
        .find(item => item.tile.owner === game.activePlayer && canProduceUnit(item.tile.kind, kind)
          && !game.units.some(unit => isDeployedUnit(unit) && unit.position.x === item.x && unit.position.y === item.y));
      if (!facility) { message = '生産可能な空き施設がありません。'; render(); return; }
      if (dispatch({ type: 'produce', factory: { x: facility.x, y: facility.y }, kind }, true)) message = '生産しました。';
      render();
    });
    document.querySelector<HTMLButtonElement>('#capture')?.addEventListener('click', guardNormal(() => {
      if (!selected) return;
      if (dispatch({ type: 'capture', unitId: selected }, true)) message = '拠点の占領を進めました。';
      render();
    }));
    app.querySelectorAll<HTMLButtonElement>('.embark').forEach(button => button.addEventListener('click', guardNormal(() => {
      if (selected && dispatch({ type: 'embark', unitId: selected, transportId: button.dataset.transportId! }, true)) {
        message = '歩兵が輸送艦に乗船しました。次のターンから航行できます。'; selected = undefined;
      }
      render();
    })));
    app.querySelectorAll<HTMLButtonElement>('.disembark').forEach(button => button.addEventListener('click', guardNormal(() => {
      if (selected && dispatch({ type: 'disembark', transportId: selected, destination: { x: Number(button.dataset.x), y: Number(button.dataset.y) } }, true)) {
        message = '歩兵を上陸させました。'; selected = undefined;
      }
      render();
    })));
  }
  document.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', guardNormal(() => {
    resetGame(selectedMap.id); message = 'ユニットを選択して行動してください。'; render();
  }));
  document.querySelector<HTMLButtonElement>('#open-campaign')?.addEventListener('click', guardNormal(openCampaignMenu));
  document.querySelector<HTMLButtonElement>('#open-campaign-briefing')?.addEventListener('click', guardNormal(openCampaignMenu));
  document.querySelector<HTMLButtonElement>('#campaign-close')?.addEventListener('click', () => {
    campaignMenuOpen = false;
    briefingOpen = campaignReturnToBriefing;
    campaignReturnToBriefing = false;
    render();
  });
  document.querySelector<HTMLButtonElement>('#campaign-skirmish')?.addEventListener('click', () => {
    campaignRun = undefined; campaignOutcome = undefined; campaignMenuOpen = false;
    briefingOpen = campaignReturnToBriefing; campaignReturnToBriefing = false;
    message = '単体戦モードに戻りました。戦域を自由に選択できます。';
    render();
  });
  app.querySelectorAll<HTMLButtonElement>('.campaign-start').forEach(button => {
    button.addEventListener('click', () => startCampaignScenario(button.dataset.campaignId ?? ''));
  });
  document.querySelector<HTMLButtonElement>('#campaign-retry')?.addEventListener('click', () => {
    if (campaignRun) startCampaignScenario(campaignRun.scenarioId);
  });
  document.querySelector<HTMLButtonElement>('#campaign-next')?.addEventListener('click', () => {
    if (campaignOutcome?.nextScenarioId) startCampaignScenario(campaignOutcome.nextScenarioId);
  });
  document.querySelector<HTMLButtonElement>('#campaign-back')?.addEventListener('click', () => {
    campaignMenuOpen = true;
    campaignReturnToBriefing = false;
    render();
  });
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
    if (replay.playing) {
      replay.playing = false;
      clearReplayTimer();
    } else if (replay.file.commands.length > 0) {
      if (replay.index >= replay.file.commands.length) {
        replay.state = { ...structuredClone(replay.file.initialState), scenarioId: replay.file.mapId };
        replay.index = 0;
        message = 'リプレイを最初から再生します。';
      }
      replay.playing = true;
      scheduleReplay();
    }
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
  document.querySelector<HTMLButtonElement>('#begin-operation')?.addEventListener('click', () => {
    briefingOpen = false;
    message = '作戦を開始しました。ユニットを選択してください。';
    render();
  });
}

function focusBoardPosition(position: Position): void {
  focusedPosition = position;
  window.requestAnimationFrame(() => {
    const selector = `.tile[data-x="${position.x}"][data-y="${position.y}"]`;
    app.querySelectorAll<HTMLButtonElement>('.tile').forEach(tile => { tile.tabIndex = tile.matches(selector) ? 0 : -1; });
    app.querySelector<HTMLButtonElement>(selector)?.focus();
  });
}

function handleBoardKey(event: KeyboardEvent, position: Position): void {
  const next = nextBoardPosition(position, game.board.width, game.board.height, event.key);
  if (next) {
    event.preventDefault();
    focusBoardPosition(next);
    return;
  }
  if (event.key === 'Escape' && selected) {
    event.preventDefault();
    selected = undefined;
    message = 'ユニットの選択を解除しました。';
    render();
    focusBoardPosition(position);
  }
}

function act(position: Position): void {
  if (replay || game.activePlayer !== 'red') return;
  const target = game.units.find(unit => isDeployedUnit(unit) && key(unit.position) === key(position));
  const visible = new Set(visiblePositions(game, 'red').map(key));
  if (target?.owner === 'blue' && !visible.has(key(position))) {
    message = 'その地点へは移動できません。';
  } else if (target?.owner === game.activePlayer) {
    selected = target.id;
    message = `${unitNames[target.kind]}を選択しました。`;
  } else if (target && selected) {
    if (dispatch({ type: 'attack', unitId: selected, targetId: target.id }, true)) message = '攻撃しました。';
    selected = undefined;
  } else if (selected && dispatch({ type: 'move', unitId: selected, destination: position }, true)) message = '移動しました。';
  render();
}
function runCpu(): void {
  if (replay) return;
  for (let steps = 0; steps < 30 && game.activePlayer === 'blue' && !game.winner; steps += 1) {
    const action = chooseCpuAction(game, difficulty);
    if (action.type === 'endTurn') { dispatch(action); break; }
    if (!dispatch(action)) { dispatch({ type: 'endTurn' }); break; }
  }
  if (game.activePlayer === 'blue' && !game.winner) {
    dispatch({ type: 'endTurn' });
    message = 'CPU の行動上限に達したため、ターンを終了しました。';
  }
  undoStack = [];
  if (persist(AUTO_SAVE_KEY)) message = 'CPU が行動しました。オートセーブしました。';
}
render();
