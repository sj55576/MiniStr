import './style.css';
import { isEmbarkableUnit, isMergeableUnit, transportCapacity } from './game';
import { allProducibleUnitKinds, applyEditorTool, applyGameCommand, AUTO_SAVE_KEY, availableScenarios, campaignStages, countProductionFacilities, createCampaignProgress, createReplay, createScenarioEditor, createScenarioInitialState, damageRange, deleteSaves, describeVictoryCondition, enemyThreatPreview, exportScenarioEditorJson, forecastCombat, getConditionProgress, gradeCampaignBattle, hasSavedGame, hasStoredSaveData, idleProductionFacilities, importScenarioEditorJson, isCampaignScenarioUnlocked, isDeployedUnit, isPropertyTerrainKind, loadCampaignProgress, loadCustomScenarios, loadGame, MANUAL_SAVE_KEY, maps, MAX_REPLAY_BYTES, parseReplay, productionKindsForRule, productionRules, reachablePositionsForPlayer, recordCampaignVictory, saveCampaignProgress, saveCustomScenario, saveGame, scenarioById, scenarioLoadError, serializeReplay, summarizeReplay, terrainKinds, validateEditorScenario, type CampaignGradeResult, type DeployedUnit, type GameCommand, type GameState, type PlayerId, type Position, type ProductionRule, type ReplayFile, type ScenarioEditorState, type TerrainKind, type UnitKind, type VictoryCondition, unitStats, visibleEnemies, visibleEnemyThreats, visiblePositions } from './game';
import { chooseCpuAction, type CpuDifficulty } from './ai';
import { nextBoardPosition } from './ui/boardNavigation';
import { BOARD_ZOOM_LEVELS, boardAreaWidth, boardTileSize, boardZoomPercent, defaultBoardZoomIndex } from './ui/boardZoom';
import { terrainNames, unitNames, unitTokens } from './ui/labels';
import { describeTileInspection, inspectTile, type InspectorRow } from './ui/tileInspector';
import { COMMAND_SPEEDS, CommandScheduler, type CommandSpeed } from './ui/commandScheduler';
import { presentationEffectsForCommand, renderPresentationEffects, type PresentationEffect } from './ui/presentationEffects';
import { loadSoundSettings, ProceduralSoundPlayer, saveSoundSettings, type SoundSettings } from './ui/sound';
import { commandErrorMessage, escapeHtml, uiText } from './ui/strings';
import { renderSaveSlotManager } from './ui/saveSlots';
import { deleteSaveSlot, getStorageUsage, listSaveSlots, loadGameFromSlot, saveGameToSlot } from './game';

let selectedMap = maps[0]!;
let game = start(selectedMap.id);
let selected: string | undefined;
let focusedPosition: Position = { x: 0, y: 0 };
let message: string = uiText.defaultInstruction;
const loadedCustomScenarios = loadCustomScenarios(localStorage);
if (!loadedCustomScenarios.ok) message = loadedCustomScenarios.error;
let difficulty: CpuDifficulty = 'normal';
let boardZoomIndex = defaultBoardZoomIndex(boardAreaWidth(window.innerWidth), game.board.width);
/** Cleared the first time the player uses the zoom controls, so a resize stops overriding them. */
let boardZoomAuto = true;
/** Production target chosen by tapping an idle facility; falls back to the first free one. */
let selectedFacility: Position | undefined;
let initialState = structuredClone(game);
let commandHistory: GameCommand[] = [];
let undoStack: { state: GameState; commandCount: number }[] = [];
interface ReplayRuntime { file: ReplayFile; state: GameState; index: number; playing: boolean; speed: CommandSpeed }
let replay: ReplayRuntime | undefined;
const commandScheduler = new CommandScheduler();
let cpuInProgress = false;
let cpuSkipRequested = false;
let cpuActivity: string[] = [];
let cpuSpeed: CommandSpeed = 1;
let skipCpuImmediately: (() => void) | undefined;
const CPU_STEP_DELAY_MS = 350;
let briefingOpen = true;
let campaignMenuOpen = false;
let campaignReturnToBriefing = false;
let campaignRun: { scenarioId: string } | undefined;
let campaignOutcome: { result: CampaignGradeResult; persisted: boolean; nextScenarioId?: string } | undefined;
let editorOpen = false;
let editor: ScenarioEditorState = createScenarioEditor();
let editorNotice = '';
let focusSelector: string | undefined;
const END_TURN_CONFIRM_KEY = 'ministr.confirmEndTurnWithUnacted';
let confirmEndTurnWithUnacted = localStorage.getItem(END_TURN_CONFIRM_KEY) !== 'false';
const loadedCampaign = loadCampaignProgress(localStorage);
let campaignProgress = loadedCampaign.ok ? loadedCampaign.value : createCampaignProgress();
let campaignNotice = loadedCampaign.ok ? '' : loadedCampaign.error;
const app = document.querySelector<HTMLDivElement>('#app')!;
const difficultyNames: Record<CpuDifficulty, string> = { easy: '易しい', normal: '普通', hard: '難しい' };
let soundSettings: SoundSettings = loadSoundSettings(localStorage);
const soundPlayer = new ProceduralSoundPlayer(soundSettings);
let pendingPresentationEffects: PresentationEffect[] = [];

// The context is intentionally created only from a real user gesture. CPU and
// replay playback before that gesture remain silent under browser autoplay rules.
app.addEventListener('pointerdown', () => { void soundPlayer.unlock(); }, { capture: true });
app.addEventListener('keydown', () => { void soundPlayer.unlock(); }, { capture: true });

const producibleUnits = allProducibleUnitKinds;
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
const adjacent = (first: Position, second: Position) => Math.abs(first.x - second.x) + Math.abs(first.y - second.y) === 1;

function unactedRedUnits(state: GameState): DeployedUnit[] {
  return state.units.filter((unit): unit is DeployedUnit => isDeployedUnit(unit) && unit.owner === 'red' && !unit.hasActed);
}

function fuelTurnsRemaining(unit: DeployedUnit): number | undefined {
  const stats = unitStats[unit.kind];
  if (stats.fuelPerTurn === 0) return undefined;
  return Math.ceil((unit.fuel ?? stats.fuel) / stats.fuelPerTurn);
}

function objectiveProgress(condition: VictoryCondition, state: GameState, player: PlayerId): string {
  const progress = getConditionProgress(state, condition, player);
  return progress.complete ? '達成' : `${progress.current} / ${progress.target}`;
}

function objectiveList(conditions: readonly VictoryCondition[], state: GameState, player: PlayerId): string {
  if (conditions.length === 0) return '<li><span>条件なし</span></li>';
  return conditions.map(condition => `<li><span>${escapeHtml(describeVictoryCondition(condition))}</span><strong>${escapeHtml(objectiveProgress(condition, state, player))}</strong></li>`).join('');
}


const inspectorRows = (rows: readonly InspectorRow[]) => `<dl class="tile-inspector-rows">${rows.map(row => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl>`;

/**
 * Touch devices never hover, so the board's tooltips are unreachable there. This
 * panel is the primary way to read a tile, and mirrors itself as one announced
 * sentence for screen readers. It is built separately from the board so moving
 * focus can refresh it without rebuilding the board.
 */
function renderTileInspector(state: GameState, productionRule: ProductionRule): string {
  const visible = new Set(visiblePositions(state, 'red').map(key));
  const selectedUnit = state.units.find(unit => unit.id === selected);
  const inspection = inspectTile(state, focusedPosition, 'red', visible,
    selectedUnit?.owner === 'red' && isDeployedUnit(selectedUnit) ? selectedUnit.kind : undefined, productionRule);
  const body = inspection
    ? `<div class="tile-inspector-head"><div><p class="card-kicker">TILE INTEL</p><h3 id="tile-inspector-title">${escapeHtml(inspection.title)}</h3></div><span class="tile-inspector-coordinate">(${inspection.position.x + 1}, ${inspection.position.y + 1})</span></div><p class="tile-inspector-summary visually-hidden" aria-live="polite">${escapeHtml(describeTileInspection(inspection))}</p>${inspectorRows(inspection.rows)}${inspection.unit ? `<div class="tile-inspector-unit"><h4>${escapeHtml(inspection.unit.title)}</h4>${inspectorRows(inspection.unit.rows)}</div>` : ''}${inspection.hidden ? '<p class="tile-inspector-fog">未索敵のマスです。ユニットを近づけて視界を広げてください。</p>' : ''}`
    : '<div class="tile-inspector-head"><div><p class="card-kicker">TILE INTEL</p><h3 id="tile-inspector-title">マスを選択してください</h3></div></div>';
  return `<section class="tile-inspector" aria-labelledby="tile-inspector-title">${body}</section>`;
}

/**
 * Focus moved by a pointer must not rebuild the board: replacing the DOM between
 * mousedown and mouseup detaches the tile, and the browser then never dispatches
 * its click — every tap would need a second one. Only the views that depend on
 * which tile has focus are patched in place. Keyboard navigation still goes
 * through `focusBoardPosition`, which renders normally.
 */
function refreshFocusedTileViews(): void {
  for (const tile of app.querySelectorAll<HTMLButtonElement>('.tile[data-x]')) {
    tile.tabIndex = Number(tile.dataset.x) === focusedPosition.x && Number(tile.dataset.y) === focusedPosition.y ? 0 : -1;
  }
  const inspector = app.querySelector('.tile-inspector');
  const renderedMap = scenarioById(replay?.file.mapId) ?? selectedMap;
  if (inspector) inspector.outerHTML = renderTileInspector(replay?.state ?? game, renderedMap.productionRules);
}

/** Re-applies the width-derived default zoom unless the player has set it themselves. */
function syncBoardZoom(boardWidth: number): void {
  if (boardZoomAuto) boardZoomIndex = defaultBoardZoomIndex(boardAreaWidth(window.innerWidth), boardWidth);
}

function resetGame(mapId: string): void {
  commandScheduler.cancel();
  cpuInProgress = false;
  cpuSkipRequested = false;
  skipCpuImmediately = undefined;
  pendingPresentationEffects = [];
  game = start(mapId);
  initialState = structuredClone(game);
  commandHistory = [];
  undoStack = [];
  selected = undefined;
  selectedFacility = undefined;
  focusedPosition = { x: 0, y: 0 };
  briefingOpen = true;
  syncBoardZoom(game.board.width);
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
  const before = game;
  const result = applyGameCommand(game, command);
  if (!result.ok) { message = commandErrorMessage(result.error); return false; }
  if (undoable && game.activePlayer === 'red') undoStack.push({ state: game, commandCount: commandHistory.length });
  game = result.value;
  commandHistory.push(command);
  if (!cpuSkipRequested) pendingPresentationEffects.push(...presentationEffectsForCommand(before, command, game));
  finishCampaignBattle();
  return true;
}

/** Keep CPU activity useful without naming units or places the player could not see. */
function recordVisibleCpuAction(before: GameState, command: GameCommand): void {
  const visible = new Set([...visiblePositions(before, 'red'), ...visiblePositions(game, 'red')].map(key));
  const visibleUnit = (id: string) => {
    const prior = before.units.find(unit => unit.id === id);
    const current = game.units.find(unit => unit.id === id);
    return [prior, current].find(unit => unit && isDeployedUnit(unit) && visible.has(key(unit.position)));
  };
  let entry: string | undefined;
  if (command.type === 'attack') {
    const target = before.units.find(unit => unit.id === command.targetId);
    const attacker = visibleUnit(command.unitId);
    entry = attacker && isDeployedUnit(attacker) && target?.owner === 'red'
      ? `敵の${unitNames[attacker.kind]}が自軍の${unitNames[target.kind]}を攻撃しました。`
      : target?.owner === 'red' ? `自軍の${unitNames[target.kind]}が攻撃を受けました。` : undefined;
  } else if (command.type === 'move') {
    const unit = visibleUnit(command.unitId);
    entry = unit && isDeployedUnit(unit) ? `敵の${unitNames[unit.kind]}が視認範囲内で移動しました。` : undefined;
  } else if (command.type === 'capture') {
    const unit = visibleUnit(command.unitId);
    entry = unit && isDeployedUnit(unit) ? `敵の${unitNames[unit.kind]}が視認範囲内の拠点を占領中です。` : undefined;
  }
  if (entry) cpuActivity = [...cpuActivity, entry].slice(-6);
}
function persist(key: string): boolean {
  const result = saveGame(localStorage, key, {
    mapId: selectedMap.id, difficulty, initialState, commands: commandHistory, gameState: game,
    campaignScenarioId: campaignRun?.scenarioId,
  });
  message = result.ok ? 'セーブしました。' : result.error;
  return result.ok;
}
function saveNamedSlot(): void {
  const name = window.prompt('セーブ名を入力してください（40文字まで）', selectedMap.name)?.trim();
  if (!name) return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = saveGameToSlot(localStorage, id, name, {
    mapId: selectedMap.id, difficulty, initialState, commands: commandHistory, gameState: game,
    campaignScenarioId: campaignRun?.scenarioId,
  });
  message = result.ok ? `「${name}」にセーブしました。` : result.error;
}
function hasSave(): boolean {
  return hasSavedGame(localStorage);
}
function hasStoredSave(): boolean {
  return hasStoredSaveData(localStorage);
}
function continueSavedGame(slotId?: string): void {
  commandScheduler.cancel();
  cpuInProgress = false;
  cpuSkipRequested = false;
  campaignRun = undefined;
  campaignOutcome = undefined;
  const loaded = slotId ? loadGameFromSlot(localStorage, slotId) : loadGame(localStorage);
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
  selectedFacility = undefined;
  focusedPosition = { x: 0, y: 0 };
  briefingOpen = false;
  syncBoardZoom(game.board.width);
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


function completedReplay(): ReturnType<typeof createReplay> {
  return createReplay({ mapId: selectedMap.id, difficulty, initialState, commands: commandHistory });
}
function beginReplay(file: ReplayFile): void {
  commandScheduler.cancel();
  cpuInProgress = false;
  cpuSkipRequested = false;
  skipCpuImmediately = undefined;
  pendingPresentationEffects = [];
  replay = { file: structuredClone(file), state: { ...structuredClone(file.initialState), scenarioId: file.mapId }, index: 0, playing: false, speed: 1 };
  selected = undefined; selectedFacility = undefined; briefingOpen = false; syncBoardZoom(replay.state.board.width); message = 'リプレイを読み込みました。再生ボタンで開始できます。'; render();
}
function advanceReplay(): boolean {
  if (!replay || replay.index >= replay.file.commands.length) {
    if (replay) replay.playing = false;
    commandScheduler.cancel(); render(); return false;
  }
  const before = replay.state;
  const command = replay.file.commands[replay.index]!;
  const result = applyGameCommand(before, command);
  if (!result.ok) {
    replay.playing = false; commandScheduler.cancel();
    message = `リプレイを再生できません: ${commandErrorMessage(result.error)}`; render(); return false;
  }
  replay.state = result.value;
  pendingPresentationEffects.push(...presentationEffectsForCommand(before, command, replay.state));
  replay.index += 1;
  if (replay.index >= replay.file.commands.length) {
    replay.playing = false; commandScheduler.cancel(); message = 'リプレイの再生が完了しました。';
  }
  render();
  return replay.playing;
}
function scheduleReplay(): void {
  if (!replay?.playing || replay.index >= replay.file.commands.length) return;
  commandScheduler.start({ step: advanceReplay, nextDelayMs: () => 1000 / replay!.speed });
}
function leaveReplay(): void {
  commandScheduler.cancel(); pendingPresentationEffects = []; replay = undefined; selected = undefined;
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
  if (!focusSelector && activeElement instanceof HTMLElement && app.contains(activeElement)) {
    if (activeElement.id) focusSelector = `#${activeElement.id}`;
    else if (activeElement.matches('.produce[data-kind]')) focusSelector = `.produce[data-kind="${activeElement.dataset.kind}"]`;
    else if (activeElement.matches('.tile[data-x][data-y]')) focusSelector = `.tile[data-x="${activeElement.dataset.x}"][data-y="${activeElement.dataset.y}"]`;
  }
  const replayMode = replay !== undefined;
  const renderedGame = replay?.state ?? game;
  const renderedMap = scenarioById(replay?.file.mapId) ?? selectedMap;
  const productionRule = renderedMap.productionRules;
  const renderedDifficulty = replay?.file.difficulty ?? difficulty;
  const tileSize = boardTileSize(boardZoomIndex);
  const boardViewportHeight = renderedGame.board.height * tileSize + 10;
  const visible = new Set(visiblePositions(renderedGame, 'red').map(key));
  const selectedUnit = renderedGame.units.find(unit => unit.id === selected);
  const movable = !replayMode && selectedUnit?.owner === 'red' && !selectedUnit.hasMoved && !selectedUnit.hasActed
    ? new Set(reachablePositionsForPlayer(renderedGame, selectedUnit.id, 'red').map(key)) : new Set<string>();
  const focusedUnit = renderedGame.units.find(unit => isDeployedUnit(unit) && key(unit.position) === key(focusedPosition));
  const previewedEnemy = selectedUnit?.owner === 'blue' && isDeployedUnit(selectedUnit)
    ? selectedUnit
    : focusedUnit?.owner === 'blue' && isDeployedUnit(focusedUnit) && visible.has(key(focusedUnit.position)) ? focusedUnit : undefined;
  const previewedEnemyThreat = previewedEnemy ? enemyThreatPreview(renderedGame, previewedEnemy.id, 'red') : { movement: new Set<string>(), attack: new Set<string>() };
  const knownEnemyThreats = selectedUnit?.owner === 'red' ? visibleEnemyThreats(renderedGame, 'red') : new Set<string>();
  // Resolved before the board is drawn so idle facilities can be marked on the
  // tiles that produce, not only counted in the panel.
  const idleFacilities = idleProductionFacilities(renderedGame, 'red', productionRule);
  const targetFacility = selectedFacility && idleFacilities.find(facility => key(facility.position) === key(selectedFacility!));
  const idleFacilityKeys = new Set(idleFacilities.map(facility => key(facility.position)));
  const board = renderedGame.board.terrain.flatMap((row, y) => row.map((terrain, x) => {
    const unit = renderedGame.units.find(item => isDeployedUnit(item) && item.position.x === x && item.position.y === y);
    const hidden = !visible.has(`${x},${y}`);
    const terrainName = terrainNames[terrain.kind] ?? terrain.kind;
    const isProperty = isPropertyTerrainKind(terrain.kind);
    const propertyOwner = isProperty ? terrain.owner : undefined;
    const capturePoints = isProperty ? terrain.capturePoints : undefined;
    const facilityDetail = terrain.kind === 'port' ? '、補給・艦艇を生産可能' : terrain.kind === 'airport' ? '、補給・航空ユニットを生産可能' : terrain.kind === 'factory' ? '、補給・地上ユニット生産拠点' : '';
    const propertyLabel = isProperty ? `${terrainName}${propertyOwner ? `（${propertyOwner === 'red' ? '自軍' : '敵軍'}）` : '（中立）'}${capturePoints !== undefined ? `、占領値 ${capturePoints}` : ''}${facilityDetail}` : terrainName;
    const cargo = unit && transportCapacity(unit.kind) > 0 ? renderedGame.units.find(candidate => candidate.embarkedIn === unit.id) : undefined;
    // Fuel data stays private: only warn about the player's own units, never
    // expose an enemy's exact reserve through a visible tile.
    const fuelTurns = unit && isDeployedUnit(unit) && unit.owner === 'red' ? fuelTurnsRemaining(unit) : undefined;
    const fuelWarning = fuelTurns !== undefined && fuelTurns <= 2
      ? `、燃料警告: ${unit!.fuel ?? unitStats[unit!.kind].fuel}、補給まで残り ${fuelTurns} 行動機会`
      : '';
    const unitLabel = unit && !hidden ? `${unit.owner === 'red' ? 'プレイヤー' : 'CPU'}の${unitNames[unit.kind]}、耐久 ${unit.hp}${cargo ? `、搭載 ${unitNames[cargo.kind]}` : ''}${fuelWarning}` : '';
    const label = unit && !hidden
      ? `<span class="unit ${unit.owner} unit-${unit.kind}" aria-hidden="true"><b>${unitTokens[unit.kind]}</b><small>${unit.hp}</small><em>${unitNames[unit.kind]}${cargo ? `・${unitNames[cargo.kind]}搭載` : ''}</em><i class="unit-owner-marker">${unit.owner === 'red' ? '自' : '敵'}</i>${cargo ? '<i class="cargo-marker">積</i>' : ''}${fuelWarning ? `<i class="fuel-warning">燃${fuelTurns}</i>` : ''}</span>`
      : '';
    const facility = isProperty && !hidden
      ? `<span class="facility facility-${terrain.kind} ${propertyOwner ?? 'neutral'}" aria-hidden="true"><b>${terrain.kind === 'city' ? '市' : terrain.kind === 'factory' ? '工' : terrain.kind === 'airport' ? '空' : terrain.kind === 'port' ? '港' : '司'}</b><small>${propertyOwner === 'red' ? '自軍' : propertyOwner === 'blue' ? '敵軍' : '中立'}${capturePoints !== undefined ? ` ${capturePoints}` : ''}</small></span>`
      : '';
    // `selected` is undefined until a unit is picked, so the unit must exist too:
    // comparing two undefined values would mark every empty tile as selected.
    const isSelected = selected !== undefined && unit?.id === selected;
    const isReachable = movable.has(`${x},${y}`);
    const enemyMovement = previewedEnemyThreat.movement.has(`${x},${y}`);
    const enemyAttack = previewedEnemyThreat.attack.has(`${x},${y}`);
    const movementDanger = isReachable && knownEnemyThreats.has(`${x},${y}`);
    const productionReady = !hidden && idleFacilityKeys.has(`${x},${y}`);
    const isFacilityTarget = productionReady && !!targetFacility && key(targetFacility.position) === `${x},${y}`;
    const statuses = [
      isSelected ? '選択中' : '',
      isReachable ? '移動可能' : '',
      enemyMovement ? '選択中の敵ユニットの移動範囲' : '',
      enemyAttack ? '選択中の敵ユニットの攻撃危険域' : '',
      movementDanger ? '敵の攻撃危険域' : '',
      isFacilityTarget ? '生産先に選択中' : productionReady ? '生産可能' : '',
      hidden ? '未索敵' : '',
    ].filter(Boolean);
    const stateMarker = `${isSelected ? '<span class="tile-state-marker selected-marker" aria-hidden="true">選</span>' : ''}${isReachable ? '<span class="tile-state-marker reachable-marker" aria-hidden="true">移</span>' : ''}${productionReady ? '<span class="tile-state-marker facility-ready-marker" aria-hidden="true">産</span>' : ''}${enemyMovement ? '<span class="tile-state-marker enemy-move-marker" aria-hidden="true">敵移</span>' : ''}${(enemyAttack || movementDanger) ? '<span class="tile-state-marker danger-marker" aria-hidden="true">危</span>' : ''}`;
    return `<button ${replayMode || renderedGame.activePlayer !== 'red' ? 'disabled' : ''} class="tile ${terrain.kind} ${isSelected ? 'selected' : ''} ${isReachable ? 'reachable' : ''} ${enemyMovement ? 'enemy-move-zone' : ''} ${enemyAttack ? 'enemy-attack-zone' : ''} ${movementDanger ? 'movement-danger' : ''} ${isFacilityTarget ? 'facility-target' : ''} ${hidden ? 'fog' : ''}" data-x="${x}" data-y="${y}" data-terrain="${terrain.kind}" tabindex="${focusedPosition.x === x && focusedPosition.y === y ? '0' : '-1'}" title="${propertyLabel}${unitLabel ? ` — ${unitLabel}` : ''}${statuses.length ? ` — ${statuses.join('、')}` : ''}" aria-label="${propertyLabel}${unitLabel ? `、${unitLabel}` : ''}${statuses.length ? `、${statuses.join('、')}` : ''}">${stateMarker}${facility}${label}</button>`;
  })).join('');
  const production = producibleUnits.map(kind => {
    // A chosen facility restricts the roster to what it can build; otherwise any
    // idle facility of the right type may take the order.
    const facility = targetFacility ?? idleFacilities.find(candidate => candidate.kinds.includes(kind));
    const buildable = facility !== undefined && facility.kinds.includes(kind);
    const cost = unitStats[kind].cost;
    const affordable = renderedGame.players.red.gold >= cost;
    const missing = Math.max(0, cost - renderedGame.players.red.gold);
    const productionTerrain = (['port', 'airport', 'factory'] as const).find(terrain => productionKindsForRule(productionRule)[terrain]?.includes(kind));
    const facilityName = terrainNames[facility?.kind ?? productionTerrain ?? 'factory'];
    const where = buildable ? `${facilityName} (${facility.position.x + 1}, ${facility.position.y + 1})` : facilityName;
    const availability = !buildable ? '生産可能な空き施設がありません' : !affordable ? `資金不足（あと ${missing}G）` : '生産可能';
    return `<button class="produce produce-${kind}" data-kind="${kind}" ${replayMode || renderedGame.activePlayer !== 'red' || !buildable || !affordable ? 'disabled' : ''} title="${where}で${unitNames[kind]}を生産 (${cost}G) — ${availability}" aria-label="${where}で${unitNames[kind]}を${cost}ゴールドで生産、${availability}"><span aria-hidden="true">${unitTokens[kind]}</span>${unitNames[kind]} <em>${cost}G</em>${!affordable ? ` <small>資金不足（あと ${missing}G）</small>` : ''}</button>`;
  }).join('');
  const productionSummary = `<p class="production-summary">空き生産施設 <strong>${idleFacilities.length}</strong> / ${countProductionFacilities(renderedGame, 'red', productionRule)}</p>`;
  const productionTargetLine = targetFacility
    ? `<p class="production-target">生産先 <strong>${terrainNames[targetFacility.kind]} (${targetFacility.position.x + 1}, ${targetFacility.position.y + 1})</strong><button id="clear-production-facility" class="save-action">自動選択</button></p>`
    : '<p class="production-target">生産先 <strong>自動選択</strong>（盤面の「産」マスを選ぶと指定できます）</p>';
  const activeLabel = renderedGame.activePlayer === 'red' ? 'プレイヤー' : 'CPU';
  const selectedTerrain = selectedUnit && isDeployedUnit(selectedUnit) ? renderedGame.board.terrain[selectedUnit.position.y]?.[selectedUnit.position.x] : undefined;
  const canCapture = selectedUnit?.owner === renderedGame.activePlayer && isDeployedUnit(selectedUnit)
    && !selectedUnit.hasActed && unitStats[selectedUnit.kind].capturePower > 0 && selectedTerrain
    && isPropertyTerrainKind(selectedTerrain.kind) && selectedTerrain.owner !== renderedGame.activePlayer;
  const captureAction = !replayMode && canCapture ? `<section class="capture-card"><p class="card-kicker">PROPERTY ACTION</p><strong>${terrainNames[selectedTerrain!.kind]}を占領</strong><span>${selectedTerrain!.owner === 'blue' ? '敵軍' : '中立'}拠点・占領値 ${selectedTerrain!.capturePoints ?? '—'}</span><button class="capture" id="capture" aria-label="この拠点を占領する">占領する</button></section>` : '';
  const canWait = !replayMode && selectedUnit?.owner === renderedGame.activePlayer && isDeployedUnit(selectedUnit) && !selectedUnit.hasActed;
  const waitAction = canWait ? `<section class="capture-card"><p class="card-kicker">UNIT ACTION</p><strong>${unitNames[selectedUnit!.kind]}の行動</strong><span>移動・攻撃・占領を行わず、この部隊の行動を終了します。</span><button id="wait" aria-label="選択中のユニットの行動を終了する">行動を終了</button></section>` : '';
  const mergeTargets = !replayMode && selectedUnit?.owner === renderedGame.activePlayer && isDeployedUnit(selectedUnit) && !selectedUnit.hasActed
    ? renderedGame.units.filter(unit => isDeployedUnit(unit) && unit.owner === selectedUnit.owner && unit.kind === selectedUnit.kind
      && isMergeableUnit(unit.kind) && !unit.hasActed && adjacent(selectedUnit.position, unit.position))
    : [];
  const mergeAction = mergeTargets.length > 0
    ? `<section class="capture-card merge-card"><p class="card-kicker">UNIT ACTION</p><strong>${unitNames[selectedUnit!.kind]}を合流</strong><span>隣接する同種部隊を1部隊にまとめます。耐久・補給値を合算し、選択中の部隊が行動済みになります。</span>${mergeTargets.map(unit => `<button class="merge" data-target-id="${escapeHtml(unit.id)}">${unitNames[unit.kind]}（${unit.position!.x + 1}, ${unit.position!.y + 1}）と合流</button>`).join('')}</section>`
    : '';
  const selectedUnitActions = captureAction || waitAction || mergeAction
    ? `<section class="unit-action-cluster" aria-label="選択中ユニットの操作">${captureAction}${waitAction}${mergeAction}</section>`
    : '';
  const embarkTargets = selectedUnit?.owner === renderedGame.activePlayer && isDeployedUnit(selectedUnit) && isEmbarkableUnit(selectedUnit.kind) && !selectedUnit.hasActed
    ? renderedGame.units.filter((unit) => isDeployedUnit(unit) && transportCapacity(unit.kind) > 0 && unit.owner === selectedUnit.owner
      && !unit.hasMoved && !unit.hasActed && adjacent(selectedUnit.position, unit.position)
      && !renderedGame.units.some(candidate => candidate.embarkedIn === unit.id))
    : [];
  const cargo = selectedUnit && isDeployedUnit(selectedUnit) && transportCapacity(selectedUnit.kind) > 0 ? renderedGame.units.find(unit => unit.embarkedIn === selectedUnit.id) : undefined;
  const landingTargets = selectedUnit?.owner === renderedGame.activePlayer && isDeployedUnit(selectedUnit) && transportCapacity(selectedUnit.kind) > 0
    && !selectedUnit.hasMoved && !selectedUnit.hasActed && cargo
    ? [{ x: selectedUnit.position.x + 1, y: selectedUnit.position.y }, { x: selectedUnit.position.x - 1, y: selectedUnit.position.y }, { x: selectedUnit.position.x, y: selectedUnit.position.y + 1 }, { x: selectedUnit.position.x, y: selectedUnit.position.y - 1 }]
      .filter(position => {
        const terrain = renderedGame.board.terrain[position.y]?.[position.x];
        return terrain?.kind !== undefined && terrain.kind !== 'sea' && !renderedGame.units.some(unit => isDeployedUnit(unit) && key(unit.position) === key(position));
      })
    : [];
  const transportAction = !replayMode && (embarkTargets.length || cargo)
    ? `<section class="transport-card"><p class="card-kicker">TRANSPORT OPERATION</p><strong>${cargo ? `${unitNames[cargo.kind]}を搭載中` : '輸送部隊への搭載'}</strong><span>${cargo ? '隣接する空の陸地を選んで降車させます。' : '隣接する空の輸送部隊を選んで搭載します。'}</span>${embarkTargets.map(unit => `<button class="transport-action embark" data-transport-id="${unit.id}">${unitNames[unit.kind]}に搭載</button>`).join('')}${landingTargets.map(position => `<button class="transport-action disembark" data-x="${position.x}" data-y="${position.y}">(${position.x + 1}, ${position.y + 1}) に降車</button>`).join('')}${cargo && landingTargets.length === 0 ? '<em class="transport-note">降車できる隣接陸地がありません。</em>' : ''}</section>`
    : '';
  const indirectFireBlocked = !replayMode && selectedUnit?.owner === renderedGame.activePlayer
    && unitStats[selectedUnit.kind].indirect && selectedUnit.hasMoved && !selectedUnit.hasActed;
  const forecasts = !replayMode && selectedUnit && selectedUnit.owner === renderedGame.activePlayer && !indirectFireBlocked
    ? visibleEnemies(renderedGame, selectedUnit.owner).map(enemy => ({ enemy, forecast: forecastCombat(renderedGame, selectedUnit, enemy) })).filter((item): item is { enemy: typeof item.enemy; forecast: Extract<typeof item.forecast, { ok: true }> } => item.forecast.ok)
    : [];
  const forecastCard = forecasts.length > 0 || indirectFireBlocked ? `<section class="forecast-card"><p class="card-kicker">戦闘予測</p>${forecasts.map(({ enemy, forecast }) => {
    const outgoing = damageRange(forecast.value.damageToDefender);
    const incoming = forecast.value.canCounter ? damageRange(forecast.value.damageToAttacker) : undefined;
    return `<div class="forecast-row"><span>${unitNames[enemy.kind]}（耐久 ${enemy.hp}）</span><span class="forecast-damage">与 ${outgoing.min}〜${outgoing.max}</span><span class="forecast-counter">被 ${incoming ? `${incoming.min}〜${incoming.max}` : 'なし'}</span></div>`;
  }).join('')}${indirectFireBlocked ? '<p class="forecast-note">間接砲は移動したターンに射撃できません。</p>' : selectedUnit!.hasActed ? '<p class="forecast-note">このユニットは行動済みです。</p>' : ''}</section>` : '';
  const summaryResult = !replayMode && renderedGame.winner ? summarizeReplay(initialState, commandHistory, renderedMap.id, difficulty) : undefined;
  const summary = summaryResult?.ok ? summaryResult.value : undefined;
  const campaignResult = campaignRun && campaignOutcome
    ? `<section class="campaign-result"><span class="campaign-grade grade-${campaignOutcome.result.grade.toLowerCase()}">${campaignOutcome.result.grade}</span><div><strong>作戦評価</strong><p>${campaignOutcome.result.score}点・残存 ${campaignOutcome.result.survivingUnits}部隊・損失 ${campaignOutcome.result.losses}部隊</p>${campaignOutcome.persisted ? '' : `<p class="campaign-save-error">${escapeHtml(campaignNotice)}</p>`}</div></section>`
    : '';
  const campaignResultActions = campaignRun
    ? `<button id="campaign-retry" class="save-action">再挑戦</button><button id="campaign-back" class="save-action">キャンペーンへ戻る</button>${campaignOutcome?.nextScenarioId ? '<button id="campaign-next" class="end-turn">次の戦場へ</button>' : ''}`
    : '<button id="restart" class="save-action">もう一度</button>';
  const gameOverOverlay = !campaignMenuOpen && !replayMode && renderedGame.winner ? `<div class="game-over" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="game-over-card"><p class="card-kicker">RESULT</p><h2 id="result-title" tabindex="-1">${renderedGame.winner === 'red' ? 'プレイヤーの勝利' : 'CPUの勝利'}</h2>${summary ? `<dl class="result-summary"><div><dt>マップ</dt><dd>${escapeHtml(renderedMap.name)}</dd></div><div><dt>難易度</dt><dd>${difficultyNames[difficulty]}</dd></div><div><dt>勝者</dt><dd>${summary.winner === 'red' ? 'プレイヤー' : 'CPU'}</dd></div><div><dt>ターン数</dt><dd>${summary.turns}</dd></div><div><dt>プレイヤー</dt><dd>撃破 ${summary.kills.red} / 占領 ${summary.captures.red}</dd></div><div><dt>CPU</dt><dd>撃破 ${summary.kills.blue} / 占領 ${summary.captures.blue}</dd></div></dl>` : `<p class="result-error">${escapeHtml(summaryResult && !summaryResult.ok ? summaryResult.error : '対局サマリーを作成できませんでした。')}</p>`}${campaignResult}<div class="result-actions"><button id="view-replay" class="save-action">リプレイを見る</button><button id="export-replay" class="save-action">リプレイを書き出す</button>${campaignResultActions}</div></div></div>` : '';
  const commander = renderedGame.activePlayer === 'red'
    ? { image: './assets/commander-red.png', alt: '赤軍司令官の肖像', title: 'RED COMMAND', label: '前線司令部' }
    : { image: './assets/commander-blue.png', alt: '青軍司令官の肖像', title: 'BLUE COMMAND', label: '敵軍司令部' };
  const mapTheme = `theme-${renderedMap.theme}`;
  const tileInspectorPanel = renderTileInspector(renderedGame, productionRule);
  // The current numbered turn is still playable; timeout is normalized to a
  // survive condition that resolves only after this count reaches zero.
  const remainingTurns = renderedMap.turnLimit === undefined ? undefined : Math.max(0, renderedMap.turnLimit - renderedGame.turn + 1);
  const objectivePanel = `<section class="objective-card" aria-labelledby="objective-title"><div class="objective-heading"><div><p class="card-kicker">MISSION</p><h2 id="objective-title">作戦目標</h2></div>${remainingTurns === undefined ? `<span class="turn-limit unlimited">制限なし</span>` : `<span class="turn-limit"><strong>${remainingTurns}</strong> 残りターン</span>`}</div><div class="objective-group victory"><h3>勝利条件</h3><ul>${objectiveList(renderedMap.victoryConditions, renderedGame, 'red')}</ul></div><div class="objective-group defeat"><h3>敗北条件</h3><ul>${objectiveList(renderedMap.defeatConditions, renderedGame, 'blue')}</ul></div></section>`;
  const unactedUnits = !replayMode && renderedGame.activePlayer === 'red' ? unactedRedUnits(renderedGame) : [];
  const unitQueuePanel = !replayMode ? `<section class="unit-queue-card" aria-labelledby="unit-queue-title"><div><p class="card-kicker">UNIT STATUS</p><h2 id="unit-queue-title">未行動部隊 <strong>${unactedUnits.length}</strong></h2></div>${unactedUnits.length ? `<ol>${unactedUnits.map(unit => `<li><button class="unit-queue-item" data-unit-id="${unit.id}" aria-label="${unitNames[unit.kind]}、耐久 ${unit.hp}、マス ${unit.position.x + 1}、${unit.position.y + 1} を選択"><span aria-hidden="true">${unitTokens[unit.kind]}</span>${unitNames[unit.kind]} <em>${unit.hp}</em></button></li>`).join('')}</ol><button id="next-unit" class="save-action" ${renderedGame.activePlayer === 'red' ? '' : 'disabled'}>次の未行動部隊 <kbd>N</kbd></button>` : '<p class="unit-queue-empty">未行動の自軍ユニットはありません。</p>'}</section>` : '';
  // Phones put the command panel a long scroll below the board, so the actions a
  // turn actually needs stay reachable in a bar fixed to the bottom of the screen.
  const mobileActionBar = !replayMode
    ? `<nav class="mobile-action-bar" aria-label="クイック操作"><button id="mobile-next-unit" class="mobile-action" ${renderedGame.activePlayer === 'red' && unactedUnits.length > 0 ? '' : 'disabled'}><span aria-hidden="true">▶</span>未行動 <strong>${unactedUnits.length}</strong></button><button id="mobile-wait" class="mobile-action" ${canWait ? '' : 'disabled'}><span aria-hidden="true">✓</span>行動終了</button><button id="mobile-capture" class="mobile-action" ${canCapture ? '' : 'disabled'}><span aria-hidden="true">⚑</span>占領</button><button id="mobile-panel" class="mobile-action"><span aria-hidden="true">☰</span>作戦情報</button><button id="mobile-end" class="mobile-action mobile-action-primary" ${renderedGame.activePlayer !== 'red' || cpuInProgress ? 'disabled' : ''}><span aria-hidden="true">→</span>ターン終了</button></nav>`
    : '';
  const turnSetting = !replayMode ? `<section class="turn-setting"><label><input id="confirm-end-turn" type="checkbox" ${confirmEndTurnWithUnacted ? 'checked' : ''}> 未行動部隊がいる時にターン終了を確認する</label></section>` : '';
  const saveSlotManager = !replayMode ? renderSaveSlotManager(listSaveSlots(localStorage), getStorageUsage(localStorage)) : '';
  const cpuActivityPanel = !replayMode ? `<section class="intel-card" aria-labelledby="cpu-activity-title"><p class="card-kicker">ENEMY ACTIVITY</p><h2 id="cpu-activity-title">直前のCPU行動</h2>${cpuActivity.length ? `<ol>${cpuActivity.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}</ol>` : '<p>視認できる敵行動はありません。</p>'}</section>` : '';
  const campaignCards = campaignMenuOpen ? campaignStages.map((stage, index) => {
    const map = maps.find(candidate => candidate.id === stage.scenarioId);
    const unlocked = !!map && isCampaignScenarioUnlocked(campaignProgress, stage.scenarioId);
    const grade = campaignProgress.bestGrades[stage.scenarioId];
    if (!map) return `<article class="campaign-stage locked"><div class="campaign-stage-number">0${index + 1}</div><div><p class="card-kicker">UNAVAILABLE</p><h3>作戦データを読み込めません</h3><p>組み込みシナリオの読み込みに失敗したため、この作戦は開始できません。</p><span>推奨 ${stage.recommendedTurns} ターン</span></div><button class="save-action" disabled>利用不可</button></article>`;
    return `<article class="campaign-stage ${unlocked ? '' : 'locked'}"><div class="campaign-stage-number">0${index + 1}</div><div><p class="card-kicker">${grade ? 'CLEARED' : unlocked ? 'OPEN' : 'LOCKED'}</p><h3>${escapeHtml(map.name)}</h3><p>${escapeHtml(map.briefing)}</p><span>推奨 ${stage.recommendedTurns} ターン</span></div>${grade ? `<strong class="campaign-grade grade-${grade.toLowerCase()}">${grade}</strong>` : ''}<button class="save-action campaign-start" data-campaign-id="${stage.scenarioId}" ${unlocked ? '' : 'disabled'}>${grade ? '再出撃' : '作戦開始'}</button></article>`;
  }).join('') : '';
  const campaignOverlay = campaignMenuOpen ? `<div class="campaign-overlay" role="dialog" aria-modal="true" aria-labelledby="campaign-title"><section class="campaign-screen"><div class="campaign-heading"><div><p class="card-kicker">MINI CAMPAIGN</p><h2 id="campaign-title">国境戦役</h2><p>${campaignStages.length}つの戦場を勝ち抜き、最高評価を目指してください。</p></div><div class="campaign-heading-actions"><button id="campaign-skirmish" class="save-action">単体戦へ</button><button id="campaign-close" class="save-action">閉じる</button></div></div>${campaignNotice ? `<p class="campaign-notice" aria-live="polite">${escapeHtml(campaignNotice)}</p>` : ''}<div class="campaign-grid">${campaignCards}</div></section></div>` : '';
  const editorVictory = editor.data.victoryConditions[0] ?? { type: 'captureCapital' as const };
  const editorVictoryTarget = editorVictory.type === 'hold' ? editorVictory.turns : editorVictory.type === 'survive' ? editorVictory.untilTurn : editorVictory.type === 'score' ? editorVictory.target : 1;
  const editorBoard = Array.from({ length: editor.data.board.height }, (_, y) => Array.from({ length: editor.data.board.width }, (_, x) => {
    const cell = editor.data.board.cells.find(([cellX, cellY]) => cellX === x && cellY === y);
    const terrain = cell?.[2] ?? 'plain';
    const owner = cell?.[3];
    const unit = editor.data.initialUnits.find(candidate => candidate.x === x && candidate.y === y);
    const ownerLabel = owner === 'red' ? '自' : owner === 'blue' ? '敵' : '';
    return `<button class="editor-tile ${terrain} ${editor.selected.x === x && editor.selected.y === y ? 'selected' : ''}" data-editor-x="${x}" data-editor-y="${y}" title="(${x + 1}, ${y + 1}) ${terrainNames[terrain]}${ownerLabel ? `・${ownerLabel}` : ''}${unit ? `・${unitNames[unit.kind]}` : ''}" aria-label="(${x + 1}, ${y + 1}) ${terrainNames[terrain]}${unit ? `、${unitNames[unit.kind]}` : ''}"><span>${terrain === 'plain' ? '' : terrain === 'forest' ? '森' : terrain === 'mountain' ? '山' : terrain === 'sea' ? '海' : terrain === 'road' ? '道' : terrain === 'city' ? '市' : terrain === 'factory' ? '工' : terrain === 'airport' ? '空' : terrain === 'port' ? '港' : '司'}</span><i>${ownerLabel}</i>${unit ? `<b class="${unit.owner}">${unitTokens[unit.kind]}</b>` : ''}</button>`;
  }).join('')).join('');
  const editorOverlay = editorOpen ? `<div class="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="editor-title"><section class="editor-screen"><div class="editor-heading"><div><p class="card-kicker">SCENARIO EDITOR</p><h2 id="editor-title">最小マップエディタ</h2><p>盤面を選択し、地形・拠点所有者・初期ユニット・勝利条件を設定します。JSONは既存の検証器で確認されます。</p></div><button id="editor-close" class="save-action">閉じる</button></div><div class="editor-layout"><section class="editor-workspace"><div class="editor-toolbar"><label>編集<select id="editor-tool"><option value="terrain" ${editor.tool === 'terrain' ? 'selected' : ''}>地形・拠点</option><option value="unit" ${editor.tool === 'unit' ? 'selected' : ''}>初期ユニット</option><option value="eraseUnit" ${editor.tool === 'eraseUnit' ? 'selected' : ''}>ユニット削除</option></select></label><label>地形<select id="editor-terrain">${terrainKinds.map(kind => `<option value="${kind}" ${kind === editor.terrain ? 'selected' : ''}>${terrainNames[kind]}</option>`).join('')}</select></label><label>所有者<select id="editor-owner"><option value="">中立 / なし</option><option value="red" ${editor.owner === 'red' ? 'selected' : ''}>自軍</option><option value="blue" ${editor.owner === 'blue' ? 'selected' : ''}>敵軍</option></select></label><label>ユニット<select id="editor-unit-kind">${(Object.keys(unitNames) as UnitKind[]).map(kind => `<option value="${kind}" ${kind === editor.unitKind ? 'selected' : ''}>${unitNames[kind]}</option>`).join('')}</select></label><label>陣営<select id="editor-unit-owner"><option value="red" ${editor.unitOwner === 'red' ? 'selected' : ''}>自軍</option><option value="blue" ${editor.unitOwner === 'blue' ? 'selected' : ''}>敵軍</option></select></label></div><div class="editor-board" style="grid-template-columns:repeat(${editor.data.board.width},1fr)">${editorBoard}</div><p class="editor-coordinates">選択中: (${editor.selected.x + 1}, ${editor.selected.y + 1})</p></section><section class="editor-fields"><label>ID<input id="editor-id" value="${escapeHtml(editor.data.id)}"></label><label>作戦名<input id="editor-name" value="${escapeHtml(editor.data.name)}"></label><label>概要<textarea id="editor-briefing">${escapeHtml(editor.data.briefing)}</textarea></label><label>開始資金<input id="editor-gold" type="number" min="0" value="${editor.data.startingGold}"></label><label>勝利条件<select id="editor-victory">${editorVictoryKinds.map(kind => `<option value="${kind}" ${editorVictory.type === kind ? 'selected' : ''}>${kind === 'eliminate' ? '敵軍を全滅' : kind === 'captureCapital' ? '敵司令部を占領' : kind === 'hold' ? '選択地点を保持' : kind === 'survive' ? '規定ターン生存' : 'スコア到達'}</option>`).join('')}</select></label><label>目標値<input id="editor-victory-target" type="number" min="1" value="${editorVictoryTarget}"></label><p class="editor-hint">「保持」は現在選択中のマスを目標にします。敗北条件は敵の司令部占領です。</p></section></div><section class="editor-json"><div><h3>JSON 入出力</h3><p>読み込み時・検証時ともに、通常のシナリオと同じ安全なバリデーションを使います。</p></div><textarea id="editor-json" aria-label="シナリオJSON">${escapeHtml(exportScenarioEditorJson(editor))}</textarea><div class="editor-actions"><button id="editor-export" class="save-action">JSONを書き出す</button><button id="editor-import" class="save-action">JSONを反映</button><button id="editor-validate" class="end-turn">シナリオを検証</button><button id="editor-start" class="end-turn">保存してこのシナリオで開始</button></div>${editorNotice ? `<p class="editor-notice" aria-live="polite">${escapeHtml(editorNotice)}</p>` : ''}</section></section></div>` : '';
  const boardZoomControls = `<div class="board-zoom-controls" aria-label="盤面の拡大率"><button id="board-zoom-out" class="save-action" aria-label="盤面を縮小" title="盤面を縮小" ${boardZoomIndex === 0 ? 'disabled' : ''}>−</button><span aria-live="polite">${boardZoomPercent(boardZoomIndex)}%</span><button id="board-zoom-in" class="save-action" aria-label="盤面を拡大" title="盤面を拡大" ${boardZoomIndex === BOARD_ZOOM_LEVELS.length - 1 ? 'disabled' : ''}>＋</button></div>`;
  const briefing = !campaignMenuOpen && !replayMode && briefingOpen ? `<div class="briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title" aria-describedby="briefing-copy"><section class="briefing-card"><p class="card-kicker">OPERATION BRIEFING</p><h2 id="briefing-title">${escapeHtml(renderedMap.name)}</h2><p id="briefing-copy" class="briefing-copy">${escapeHtml(renderedMap.briefing)}</p><div class="briefing-objectives"><section><h3>勝利条件</h3><ul>${renderedMap.victoryConditions.map(condition => `<li>${escapeHtml(describeVictoryCondition(condition))}</li>`).join('')}</ul></section><section><h3>敗北条件</h3><ul>${renderedMap.defeatConditions.map(condition => `<li>${escapeHtml(describeVictoryCondition(condition))}</li>`).join('')}</ul></section></div><div class="briefing-meta"><span>初期資金 <strong>${renderedMap.startingGold}G</strong></span><span>ターン制限 <strong>${renderedMap.turnLimit ?? 'なし'}</strong></span><span>難易度 <strong>${difficultyNames[difficulty]}</strong></span></div><div class="briefing-actions"><button id="open-campaign-briefing" class="save-action">キャンペーン</button><button id="begin-operation" class="end-turn">${campaignRun ? '作戦開始' : '単体作戦を開始'} <span aria-hidden="true">→</span></button></div></section></div>` : '';
  app.innerHTML = `<main class="game-shell">
    <header class="command-bar"><div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>MiniStr</h1><p>TACTICAL COMMAND</p></div></div><label class="map-picker">戦域<select id="map" aria-label="戦域マップを選択" ${replayMode || campaignRun ? 'disabled' : ''}><optgroup label="組み込み">${maps.map(map => `<option value="${escapeHtml(map.id)}" ${map.id === renderedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</optgroup>${availableScenarios().filter(map => !maps.some(builtIn => builtIn.id === map.id)).length ? `<optgroup label="カスタム">${availableScenarios().filter(map => !maps.some(builtIn => builtIn.id === map.id)).map(map => `<option value="${escapeHtml(map.id)}" ${map.id === renderedMap.id ? 'selected' : ''}>${escapeHtml(map.name)}</option>`).join('')}</optgroup>` : ''}</select></label><label class="map-picker">難易度<select id="difficulty" aria-label="CPUの難易度を選択" ${replayMode ? 'disabled' : ''}>${(['easy', 'normal', 'hard'] as CpuDifficulty[]).map(level => `<option value="${level}" ${level === renderedDifficulty ? 'selected' : ''}>${difficultyNames[level]}</option>`).join('')}</select></label><label class="map-picker">CPU速度<select id="cpu-speed" aria-label="CPUの行動速度を選択" ${replayMode ? 'disabled' : ''}>${COMMAND_SPEEDS.map(speed => `<option value="${speed}" ${speed === cpuSpeed ? 'selected' : ''}>${speed}x</option>`).join('')}</select></label><div class="save-controls"><button id="open-editor" class="save-action" ${replayMode ? 'disabled' : ''}>マップ編集</button><button id="open-campaign" class="save-action" ${replayMode ? 'disabled' : ''}>キャンペーン</button><button id="continue" class="save-action" ${replayMode || !hasSave() ? 'disabled' : ''}>続きから</button><button id="save" class="save-action" ${replayMode ? 'disabled' : ''}>手動セーブ</button><button id="delete-save" class="save-action" ${replayMode || !hasStoredSave() ? 'disabled' : ''}>対局セーブ削除</button><button id="undo" class="save-action" ${!replayMode && renderedGame.activePlayer === 'red' && undoStack.length > 0 ? '' : 'disabled'}>1手戻す</button><button id="import-replay" class="save-action" ${replayMode ? 'disabled' : ''}>JSON取込</button><input id="replay-file" class="visually-hidden" type="file" accept=".json,application/json" aria-label="JSONリプレイファイルを選択"></div><div class="turn-indicator ${renderedGame.activePlayer}"><span>${replayMode ? 'REPLAY' : cpuInProgress ? 'CPU THINKING' : campaignRun ? 'CAMPAIGN' : 'TURN'}</span><strong>${cpuInProgress ? 'CPU 行動中' : activeLabel}</strong></div>${cpuInProgress ? '<button id="skip-cpu" class="save-action" title="CPUの残りの行動を高速に進める">CPU をスキップ</button>' : ''}<button id="end" class="end-turn" title="現在のターンを終了" aria-label="ターンを終了する" ${replayMode || cpuInProgress ? 'disabled' : ''}>ターン終了 <span aria-hidden="true">→</span></button></header>
    ${scenarioLoadError ? `<p class="scenario-warning">組み込みシナリオの読み込みに失敗したため、緊急スカーミッシュで起動しています。${escapeHtml(scenarioLoadError)}</p>` : ''}
    <section class="sound-controls" aria-label="効果音設定"><label><input id="sound-muted" type="checkbox" ${soundSettings.muted ? 'checked' : ''}> 効果音</label><label>音量 <input id="sound-volume" type="range" min="0" max="100" value="${Math.round(soundSettings.volume * 100)}" aria-label="効果音の音量"></label></section>
    ${!hasSave() && hasStoredSave() ? '<p class="scenario-warning" role="status">有効なセーブデータを読み込めません。対局セーブ削除で削除して新規対局を開始できます。</p>' : ''}
    ${replay ? `<section class="replay-toolbar" aria-label="リプレイ再生コントロール"><div><p class="card-kicker">REPLAY</p><strong aria-live="polite">${replay.index} / ${replay.file.commands.length} 手</strong></div><button id="replay-toggle" class="end-turn" aria-label="${replay.playing ? 'リプレイを一時停止' : replay.index >= replay.file.commands.length ? 'リプレイを最初から再生' : 'リプレイを再生'}" ${replay.file.commands.length === 0 ? 'disabled' : ''}>${replay.playing ? '一時停止' : replay.index >= replay.file.commands.length ? 'もう一度再生' : '再生'}</button><button id="replay-step" class="save-action" ${replay.playing || replay.index >= replay.file.commands.length ? 'disabled' : ''}>1手送り</button><label class="replay-speed">速度<select id="replay-speed" aria-label="リプレイ再生速度">${COMMAND_SPEEDS.map(speed => `<option value="${speed}" ${speed === replay!.speed ? 'selected' : ''}>${speed}x</option>`).join('')}</select></label><button id="replay-exit" class="save-action">リプレイを終了</button></section>` : ''}
    <section class="battle-layout"><div class="battlefield-wrap ${mapTheme}"><div class="battlefield-heading"><div><p>OPERATION MAP</p><h2>${escapeHtml(renderedMap.name)}</h2></div><p class="status-message" aria-live="polite">${escapeHtml(message)}</p></div><p id="board-instructions" class="board-instructions">盤面では矢印キーでマスを移動し、Enter または Space で選択・行動、Esc で選択を解除できます。敵部隊を選択またはフォーカスすると、移動範囲と攻撃危険域を確認できます。N キーで次の未行動部隊へ移動します。</p><div id="board-viewport" class="board-viewport" tabindex="0" aria-label="盤面スクロール領域" style="max-height:min(70vh, ${boardViewportHeight}px)"><div class="board" role="group" aria-label="${escapeHtml(renderedMap.name)}の戦術マップ" aria-describedby="board-instructions" style="grid-template-columns:repeat(${renderedGame.board.width},${tileSize}px);grid-template-rows:repeat(${renderedGame.board.height},${tileSize}px);aspect-ratio:${renderedGame.board.width} / ${renderedGame.board.height}">${board}</div></div>${boardZoomControls}<div class="map-legend" aria-label="マップ凡例"><span><i class="legend-dot reachable-dot" aria-hidden="true">移</i>移動可能</span><span><i class="legend-dot danger-dot" aria-hidden="true">危</i>敵の攻撃危険域</span><span><i class="legend-dot enemy-move-dot" aria-hidden="true">敵移</i>選択敵の移動範囲</span><span><i class="legend-dot fog-dot" aria-hidden="true">?</i>未索敵</span><span><i class="legend-unit red-dot" aria-hidden="true">自</i>自軍</span><span><i class="legend-unit blue-dot" aria-hidden="true">敵</i>敵軍</span><span><i class="legend-facility" aria-hidden="true">拠</i>拠点（市・工・空・港・司）</span><span><i class="legend-dot facility-ready-dot" aria-hidden="true">産</i>生産可能</span></div>${tileInspectorPanel}</div>
    <aside id="command-panel" class="command-panel" aria-label="作戦情報" tabindex="-1">${objectivePanel}${unitQueuePanel}${selectedUnitActions}${cpuActivityPanel}<section class="commander-card ${renderedGame.activePlayer}"><img src="${commander.image}" alt="${commander.alt}"><div><p>COMMANDER</p><h2>${commander.title}</h2><span>${commander.label}</span></div></section>${transportAction}${forecastCard}<section class="intel-card"><p class="card-kicker">RESOURCES</p><div class="resource-row"><span>自軍資金</span><strong>${renderedGame.players.red.gold}<small>G</small></strong></div><div class="resource-row enemy"><span>敵軍資金</span><strong>${renderedGame.players.blue.gold}<small>G</small></strong></div></section><section class="intel-card"><p class="card-kicker">RECON</p><div class="recon-count"><strong>${visibleEnemies(renderedGame, 'red').length}</strong><span>確認済み敵部隊</span></div></section><section class="production-card"><div><p class="card-kicker">PRODUCTION</p><h2>ユニット生産</h2></div>${productionTargetLine}${productionSummary}<div class="production-grid">${production}</div></section>${turnSetting}${saveSlotManager}<p class="command-tip">歩兵は中立・敵軍の都市、工場、空港、港湾、司令部で<strong>占領</strong>できます。生産先は盤面の空き「産」マスを選び、工場・空港・港湾から対応する部隊を生産します。輸送艦は歩兵を1部隊搭載し、別の島へ上陸させられます。</p></aside>
  </section>${mobileActionBar}</main>${gameOverOverlay}${briefing}${campaignOverlay}${editorOverlay}`;
  const effects = pendingPresentationEffects;
  pendingPresentationEffects = [];
  if (effects.length) {
    const interval = cpuInProgress ? CPU_STEP_DELAY_MS / cpuSpeed : replay?.playing ? 1000 / replay.speed : undefined;
    renderPresentationEffects(app, effects, interval === undefined ? 280 : Math.max(40, Math.min(280, interval - 15)));
    for (const effect of effects) soundPlayer.play(effect.sound);
  }
  if (gameOverOverlay || briefing || campaignOverlay || editorOverlay) {
    app.querySelector('main')?.setAttribute('inert', '');
    window.setTimeout(() => document.querySelector<HTMLElement>(gameOverOverlay ? '#result-title' : editorOverlay ? '#editor-close' : campaignOverlay ? '#campaign-close' : '#begin-operation')?.focus(), 0);
  }
  else if (focusSelector) {
    const previousSelector = focusSelector;
    focusSelector = undefined;
    window.requestAnimationFrame(() => {
      const target = app.querySelector<HTMLElement>(previousSelector);
      const focusTarget = target && !('disabled' in target && target.disabled) ? target : app.querySelector<HTMLElement>('#command-panel');
      if (focusTarget?.matches('.tile')) focusTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      focusTarget?.focus({ preventScroll: true });
    });
  }
  const guardNormal = (action: () => void) => () => { if (!replay && game.activePlayer === 'red') action(); };
  app.querySelector<HTMLButtonElement>('#skip-cpu')?.addEventListener('click', () => {
    cpuSkipRequested = true;
    pendingPresentationEffects = [];
    skipCpuImmediately?.();
  });
  const updateSoundSettings = (next: SoundSettings) => {
    soundSettings = next;
    soundPlayer.setSettings(next);
    if (!saveSoundSettings(localStorage, next)) message = '効果音設定を保存できませんでした。';
  };
  app.querySelector<HTMLInputElement>('#sound-muted')?.addEventListener('change', event => {
    updateSoundSettings({ ...soundSettings, muted: (event.currentTarget as HTMLInputElement).checked });
  });
  app.querySelector<HTMLInputElement>('#sound-volume')?.addEventListener('input', event => {
    updateSoundSettings({ ...soundSettings, volume: Number((event.currentTarget as HTMLInputElement).value) / 100 });
  });
  const changeBoardZoom = (step: number) => () => {
    const next = boardZoomIndex + step;
    if (next < 0 || next >= BOARD_ZOOM_LEVELS.length) return;
    boardZoomIndex = next;
    boardZoomAuto = false;
    focusSelector = `.tile[data-x="${focusedPosition.x}"][data-y="${focusedPosition.y}"]`;
    render();
  };
  app.querySelector<HTMLButtonElement>('#board-zoom-out')?.addEventListener('click', changeBoardZoom(-1));
  app.querySelector<HTMLButtonElement>('#board-zoom-in')?.addEventListener('click', changeBoardZoom(1));
  document.querySelector<HTMLSelectElement>('#map')!.onchange = guardNormal(() => {
    campaignRun = undefined; campaignOutcome = undefined;
    resetGame(document.querySelector<HTMLSelectElement>('#map')!.value);
    message = '作戦ブリーフィングを確認してください。'; render();
  });
  document.querySelector<HTMLSelectElement>('#difficulty')!.onchange = guardNormal(() => { difficulty = document.querySelector<HTMLSelectElement>('#difficulty')!.value as CpuDifficulty; render(); });
  document.querySelector<HTMLSelectElement>('#cpu-speed')?.addEventListener('change', event => {
    cpuSpeed = Number((event.currentTarget as HTMLSelectElement).value) as CommandSpeed;
    message = `CPUの行動速度を ${cpuSpeed}x にしました。`;
    render();
  });
  document.querySelector<HTMLButtonElement>('#end')!.onclick = guardNormal(endPlayerTurn);
  document.querySelector<HTMLButtonElement>('#continue')!.onclick = guardNormal(() => { continueSavedGame(); render(); });
  document.querySelector<HTMLButtonElement>('#save')!.onclick = guardNormal(() => { persist(MANUAL_SAVE_KEY); render(); });
  document.querySelector<HTMLButtonElement>('#delete-save')!.onclick = guardNormal(() => { const result = deleteSaves(localStorage); message = result.ok ? 'セーブデータを削除しました。' : result.error; render(); });
  document.querySelector<HTMLButtonElement>('#save-new-slot')?.addEventListener('click', guardNormal(() => { saveNamedSlot(); render(); }));
  app.querySelectorAll<HTMLButtonElement>('.load-save-slot').forEach(button => button.addEventListener('click', guardNormal(() => {
    continueSavedGame(button.dataset.saveSlot);
    render();
  })));
  app.querySelectorAll<HTMLButtonElement>('.delete-save-slot').forEach(button => button.addEventListener('click', guardNormal(() => {
    const result = deleteSaveSlot(localStorage, button.dataset.saveSlot ?? '');
    message = result.ok ? 'セーブスロットを削除しました。' : result.error;
    render();
  })));
  document.querySelector<HTMLButtonElement>('#undo')!.onclick = guardNormal(() => { const checkpoint = undoStack.pop(); if (checkpoint) { game = checkpoint.state; commandHistory.length = checkpoint.commandCount; selected = undefined; message = '1手戻しました。'; } render(); });
  document.querySelector<HTMLButtonElement>('#open-editor')?.addEventListener('click', guardNormal(() => {
    editorOpen = true; editorNotice = '編集したシナリオはJSONとして書き出せます。'; render();
  }));
  document.querySelector<HTMLButtonElement>('#editor-close')?.addEventListener('click', () => { editorOpen = false; render(); });
  if (editorOpen) {
    // Keep the existing compact editor markup while adding the production rule
    // as a real form control. The value is part of the exported scenario data.
    const editorFields = app.querySelector<HTMLElement>('.editor-fields');
    if (editorFields && !editorFields.querySelector('#editor-production-rule')) {
      const label = document.createElement('label');
      label.textContent = '生産ルール';
      const select = document.createElement('select');
      select.id = 'editor-production-rule';
      for (const rule of productionRules) {
        const option = document.createElement('option');
        option.value = rule;
        option.textContent = rule === 'facility-v2' ? '工場・空港・港湾を分離' : '旧形式（工場で航空機を生産）';
        option.selected = rule === editor.data.productionRules;
        select.append(option);
      }
      label.append(select);
      const victory = editorFields.querySelector('#editor-victory')?.parentElement;
      if (victory) editorFields.insertBefore(label, victory);
      else editorFields.append(label);
    }
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
    field<HTMLSelectElement>('#editor-production-rule').onchange = () => { editor = { ...editor, data: { ...editor.data, productionRules: field<HTMLSelectElement>('#editor-production-rule').value as ProductionRule } }; };
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
      tile.onfocus = () => {
        if (focusedPosition.x === position.x && focusedPosition.y === position.y) return;
        focusedPosition = position;
        refreshFocusedTileViews();
      };
    });
    app.querySelectorAll<HTMLButtonElement>('.unit-queue-item').forEach(button => button.addEventListener('click', guardNormal(() => {
      const unit = game.units.find(candidate => candidate.id === button.dataset.unitId);
      if (!unit || !isDeployedUnit(unit) || unit.owner !== 'red' || unit.hasActed) return;
      selected = unit.id;
      message = `${unitNames[unit.kind]}を選択しました。`;
      focusedPosition = { ...unit.position };
      focusSelector = `.tile[data-x="${unit.position.x}"][data-y="${unit.position.y}"]`;
      render();
    })));
    document.querySelector<HTMLButtonElement>('#next-unit')?.addEventListener('click', guardNormal(selectNextUnactedUnit));
    document.querySelector<HTMLInputElement>('#confirm-end-turn')?.addEventListener('change', event => {
      confirmEndTurnWithUnacted = (event.currentTarget as HTMLInputElement).checked;
      localStorage.setItem(END_TURN_CONFIRM_KEY, String(confirmEndTurnWithUnacted));
      message = confirmEndTurnWithUnacted ? 'ターン終了時の未行動部隊確認を有効にしました。' : 'ターン終了時の未行動部隊確認を無効にしました。';
      render();
    });
    app.querySelectorAll<HTMLButtonElement>('.produce').forEach(button => button.onclick = guardNormal(() => {
      const kind = button.dataset.kind as UnitKind;
      const facilities = idleProductionFacilities(game, 'red', selectedMap.productionRules);
      const chosen = selectedFacility && facilities.find(facility => key(facility.position) === key(selectedFacility!));
      const facility = chosen ?? facilities.find(candidate => candidate.kinds.includes(kind));
      if (!facility || !facility.kinds.includes(kind)) {
        message = chosen
          ? `${terrainNames[chosen.kind]} (${chosen.position.x + 1}, ${chosen.position.y + 1}) では${unitNames[kind]}を生産できません。`
          : '生産可能な空き施設がありません。';
        render();
        return;
      }
      if (dispatch({ type: 'produce', factory: { ...facility.position }, kind }, true)) {
        message = `${terrainNames[facility.kind]} (${facility.position.x + 1}, ${facility.position.y + 1}) で${unitNames[kind]}を生産しました。`;
        // The new unit occupies the facility, so the chosen target is spent.
        selectedFacility = undefined;
      }
      render();
    }));
    document.querySelector<HTMLButtonElement>('#clear-production-facility')?.addEventListener('click', guardNormal(() => {
      selectedFacility = undefined;
      message = '生産先を自動選択に戻しました。';
      render();
    }));
    const captureSelected = guardNormal(() => {
      if (!selected) return;
      if (dispatch({ type: 'capture', unitId: selected }, true)) message = '拠点の占領を進めました。';
      render();
    });
    document.querySelector<HTMLButtonElement>('#capture')?.addEventListener('click', captureSelected);
    const waitSelected = guardNormal(() => {
      if (selected && dispatch({ type: 'wait', unitId: selected }, true)) {
        message = 'ユニットの行動を終了しました。';
        selected = undefined;
      }
      render();
    });
    document.querySelector<HTMLButtonElement>('#wait')?.addEventListener('click', waitSelected);
    document.querySelector<HTMLButtonElement>('#mobile-wait')?.addEventListener('click', waitSelected);
    // The fixed bar mirrors existing controls rather than owning any new rule.
    document.querySelector<HTMLButtonElement>('#mobile-capture')?.addEventListener('click', captureSelected);
    document.querySelector<HTMLButtonElement>('#mobile-next-unit')?.addEventListener('click', guardNormal(selectNextUnactedUnit));
    document.querySelector<HTMLButtonElement>('#mobile-end')?.addEventListener('click', guardNormal(endPlayerTurn));
    document.querySelector<HTMLButtonElement>('#mobile-panel')?.addEventListener('click', () => {
      const panel = app.querySelector<HTMLElement>('#command-panel');
      panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      panel?.focus({ preventScroll: true });
    });
    app.querySelectorAll<HTMLButtonElement>('.merge').forEach(button => button.addEventListener('click', guardNormal(() => {
      if (selected && dispatch({ type: 'merge', unitId: selected, targetId: button.dataset.targetId! }, true)) {
        message = 'ユニットが合流しました。';
        selected = undefined;
      }
      render();
    })));
    app.querySelectorAll<HTMLButtonElement>('.embark').forEach(button => button.addEventListener('click', guardNormal(() => {
      if (selected && dispatch({ type: 'embark', unitId: selected, transportId: button.dataset.transportId! }, true)) {
        message = 'ユニットを輸送部隊に搭載しました。輸送部隊は次のターンから移動できます。'; selected = undefined;
      }
      render();
    })));
    app.querySelectorAll<HTMLButtonElement>('.disembark').forEach(button => button.addEventListener('click', guardNormal(() => {
      if (selected && dispatch({ type: 'disembark', transportId: selected, destination: { x: Number(button.dataset.x), y: Number(button.dataset.y) } }, true)) {
        message = '搭載ユニットを降車させました。'; selected = undefined;
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
      commandScheduler.cancel();
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
  focusSelector = `.tile[data-x="${position.x}"][data-y="${position.y}"]`;
  render();
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

function selectNextUnactedUnit(): void {
  const units = unactedRedUnits(game);
  if (!units.length) {
    message = '未行動の自軍ユニットはありません。';
    render();
    return;
  }
  const currentIndex = units.findIndex(unit => unit.id === selected);
  const next = units[(currentIndex + 1 + units.length) % units.length]!;
  selected = next.id;
  message = `${unitNames[next.kind]}を選択しました。未行動部隊は残り ${units.length} 部隊です。`;
  focusedPosition = { ...next.position };
  focusSelector = `.tile[data-x="${next.position.x}"][data-y="${next.position.y}"]`;
  render();
}

function endPlayerTurn(): void {
  const remaining = unactedRedUnits(game);
  if (confirmEndTurnWithUnacted && remaining.length > 0 && !window.confirm(`未行動の自軍ユニットが ${remaining.length} 部隊あります。ターンを終了しますか？`)) return;
  if (dispatch({ type: 'endTurn' })) {
    selected = undefined;
    selectedFacility = undefined;
    undoStack = [];
    if (game.activePlayer === 'blue') runCpu();
  }
  render();
}

function act(position: Position): void {
  if (replay || game.activePlayer !== 'red') return;
  const target = game.units.find(unit => isDeployedUnit(unit) && key(unit.position) === key(position));
  const visible = new Set(visiblePositions(game, 'red').map(key));
  const facility = idleProductionFacilities(game, 'red', selectedMap.productionRules).find(candidate => key(candidate.position) === key(position));
  // Any other tap drops a pending production target, so a stale one is never
  // carried into the next order.
  const hadFacilityTarget = selectedFacility !== undefined;
  selectedFacility = undefined;
  if (target?.owner === 'blue' && !visible.has(key(position))) {
    if (!moveSelectedUnit(position)) message = 'その地点へは移動できません。';
  } else if (target?.owner === game.activePlayer) {
    selected = target.id;
    message = `${unitNames[target.kind]}を選択しました。`;
  } else if (target?.owner === 'blue' && selected && selectedUnitIsRed()) {
    if (dispatch({ type: 'attack', unitId: selected, targetId: target.id }, true)) message = '攻撃しました。';
    selected = undefined;
  } else if (target?.owner === 'blue') {
    selected = target.id;
    message = `${unitNames[target.kind]}の移動範囲と攻撃危険域を表示しています。`;
  } else if (selected && selectedUnitIsRed() && moveSelectedUnit(position)) {
    // A reachable facility is a normal movement destination. Production target
    // selection is intentionally available only while no unit is selected.
  } else if (facility && !selected) {
    selectedFacility = { ...position };
    message = `${terrainNames[facility.kind]} (${position.x + 1}, ${position.y + 1}) を生産先に選びました。生産するユニットを選んでください。`;
  } else if (moveSelectedUnit(position)) {
    // The helper sets either the normal movement message or the encounter notice.
  } else if (selected && !selectedUnitIsRed()) {
    selected = undefined;
    message = '敵ユニットの危険域表示を解除しました。';
  } else if (hadFacilityTarget) {
    message = '生産先の指定を解除しました。';
  }
  render();
}

function selectedUnitIsRed(): boolean {
  return game.units.some(unit => unit.id === selected && unit.owner === 'red');
}
function moveSelectedUnit(destination: Position): boolean {
  if (!selected || !selectedUnitIsRed()) return false;
  const unitId = selected;
  if (!dispatch({ type: 'move', unitId, destination }, true)) return false;
  const finalPosition = game.units.find(unit => unit.id === unitId);
  message = !!finalPosition && isDeployedUnit(finalPosition)
    && (finalPosition.position.x !== destination.x || finalPosition.position.y !== destination.y)
    ? '敵部隊を発見し、移動を中断しました。'
    : '移動しました。';
  return true;
}
function finishCpuTurn(reachedLimit = false): void {
  if (game.activePlayer === 'blue' && !game.winner) dispatch({ type: 'endTurn' });
  cpuInProgress = false;
  cpuSkipRequested = false;
  skipCpuImmediately = undefined;
  commandScheduler.cancel();
  undoStack = [];
  message = reachedLimit ? 'CPU の行動上限に達したため、ターンを終了しました。' : 'CPU が行動しました。';
  if (persist(AUTO_SAVE_KEY)) message += ' オートセーブしました。';
  render();
}

/** Advance one CPU command per scheduler step so the board remains observable. */
function runCpu(): void {
  if (replay || cpuInProgress) return;
  cpuInProgress = true;
  cpuActivity = [];
  const maximumSteps = Math.max(30, game.units.filter(unit => isDeployedUnit(unit) && unit.owner === 'blue').length * 3 + 5);
  let steps = 0;
  const advance = (): boolean => {
    if (replay || game.activePlayer !== 'blue' || game.winner) { finishCpuTurn(); return false; }
    if (steps >= maximumSteps) { finishCpuTurn(true); return false; }
    steps += 1;
    const action = chooseCpuAction(game, difficulty);
    if (action.type === 'endTurn') { dispatch(action); finishCpuTurn(); return false; }
    const before = game;
    if (!dispatch(action)) {
      const unitId = action.type === 'move' || action.type === 'wait' || action.type === 'attack' || action.type === 'capture' || action.type === 'embark'
        ? action.unitId : action.type === 'disembark' ? action.transportId : undefined;
      if (!unitId || !dispatch({ type: 'wait', unitId })) {
        message = 'CPU の行動を安全に終了しました。';
        finishCpuTurn();
        return false;
      }
    }
    recordVisibleCpuAction(before, action);
    message = 'CPU が行動中です。';
    if (!cpuSkipRequested) render();
    return true;
  };
  skipCpuImmediately = () => {
    commandScheduler.cancel();
    while (advance()) { /* Drain synchronously so skip always reaches the final board state. */ }
  };
  commandScheduler.start({
    initialDelayMs: 0,
    step: advance,
    nextDelayMs: () => cpuSkipRequested ? 0 : CPU_STEP_DELAY_MS / cpuSpeed,
  });
}
// Orientation changes and window resizes re-derive the default zoom, but never
// overrule a rate the player set with the zoom controls.
window.addEventListener('resize', () => {
  if (!boardZoomAuto) return;
  const previous = boardZoomIndex;
  syncBoardZoom((replay?.state ?? game).board.width);
  if (boardZoomIndex !== previous) render();
});
window.addEventListener('keydown', event => {
  const target = event.target;
  const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
  if (editingText || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'n') return;
  if (replay || game.winner || briefingOpen || campaignMenuOpen || editorOpen || game.activePlayer !== 'red') return;
  event.preventDefault();
  selectNextUnactedUnit();
});

render();
