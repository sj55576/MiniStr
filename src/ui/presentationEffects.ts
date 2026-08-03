import type { GameCommand, GameState, PlayerId, Position, UnitKind } from '../game';
import { isDeployedUnit } from '../game';
import { unitTokens } from './labels';

export type SoundEvent = 'move' | 'attack' | 'hit' | 'destroy' | 'capture' | 'produce' | 'turn';

export type PresentationEffect =
  | { type: 'move'; from: Position; to: Position; kind: UnitKind; owner: PlayerId; sound: SoundEvent }
  | { type: 'damage'; position: Position; amount: number; sound: SoundEvent }
  | { type: 'destroy'; position: Position; kind: UnitKind; owner: PlayerId; sound: SoundEvent }
  | { type: 'capture' | 'produce'; position: Position; sound: SoundEvent }
  | { type: 'attack'; sound: SoundEvent }
  | { type: 'turn'; sound: SoundEvent };

const samePosition = (left: Position, right: Position) => left.x === right.x && left.y === right.y;
const deployedById = (state: GameState, id: string) => {
  const unit = state.units.find(candidate => candidate.id === id);
  return unit && isDeployedUnit(unit) ? unit : undefined;
};

/** Derives ephemeral UI feedback from an already-resolved command without changing game rules. */
export function presentationEffectsForCommand(before: GameState, command: GameCommand, after: GameState): PresentationEffect[] {
  if (command.type === 'move') {
    const start = deployedById(before, command.unitId);
    const end = deployedById(after, command.unitId);
    return start && end && !samePosition(start.position, end.position)
      ? [{ type: 'move', from: start.position, to: end.position, kind: start.kind, owner: start.owner, sound: 'move' }]
      : [];
  }
  if (command.type === 'attack') {
    const targetBefore = deployedById(before, command.targetId);
    const targetAfter = deployedById(after, command.targetId);
    const attackerBefore = deployedById(before, command.unitId);
    const attackerAfter = deployedById(after, command.unitId);
    const effects: PresentationEffect[] = [{ type: 'attack', sound: 'attack' }];
    if (targetBefore) {
      const damage = targetBefore.hp - (targetAfter?.hp ?? 0);
      if (damage > 0) effects.push({ type: 'damage', position: targetBefore.position, amount: damage, sound: 'hit' });
      if (!targetAfter) effects.push({ type: 'destroy', position: targetBefore.position, kind: targetBefore.kind, owner: targetBefore.owner, sound: 'destroy' });
    }
    if (attackerBefore && attackerAfter) {
      const damage = attackerBefore.hp - attackerAfter.hp;
      if (damage > 0) effects.push({ type: 'damage', position: attackerBefore.position, amount: damage, sound: 'hit' });
    }
    return effects;
  }
  if (command.type === 'capture') {
    const unit = deployedById(after, command.unitId) ?? deployedById(before, command.unitId);
    return unit ? [{ type: 'capture', position: unit.position, sound: 'capture' }] : [];
  }
  if (command.type === 'produce') return [{ type: 'produce', position: command.factory, sound: 'produce' }];
  if (command.type === 'endTurn') return [{ type: 'turn', sound: 'turn' }];
  return [];
}

function atTile(board: HTMLElement, position: Position): HTMLButtonElement | undefined {
  const escaped = (value: number) => String(value).replace(/"/g, '\\"');
  return board.querySelector<HTMLButtonElement>(`.tile[data-x="${escaped(position.x)}"][data-y="${escaped(position.y)}"]`) ?? undefined;
}

function appendEffect(board: HTMLElement, element: HTMLElement): void {
  element.setAttribute('aria-hidden', 'true');
  element.addEventListener('animationend', () => element.remove(), { once: true });
  board.append(element);
}

/** Renders effects outside the semantic tile controls, so focus and screen-reader order remain unchanged. */
export function renderPresentationEffects(root: ParentNode, effects: readonly PresentationEffect[], durationMs = 280): void {
  const board = root.querySelector<HTMLElement>('.board');
  if (!board) return;
  for (const effect of effects) {
    if (effect.type === 'attack') continue;
    if (effect.type === 'turn') {
      const indicator = root.querySelector<HTMLElement>('.turn-indicator');
      if (indicator) {
        indicator.classList.remove('turn-feedback');
        void indicator.offsetWidth;
        indicator.classList.add('turn-feedback');
      }
      continue;
    }
    if (effect.type === 'move') {
      const from = atTile(board, effect.from);
      const to = atTile(board, effect.to);
      if (!from || !to) continue;
      const ghost = document.createElement('span');
      ghost.className = `presentation-effect movement-ghost ${effect.owner}`;
      ghost.textContent = unitTokens[effect.kind];
      ghost.style.left = `${from.offsetLeft + from.offsetWidth * .235}px`;
      ghost.style.top = `${from.offsetTop + from.offsetHeight * .235}px`;
      ghost.style.setProperty('--move-x', `${to.offsetLeft - from.offsetLeft}px`);
      ghost.style.setProperty('--move-y', `${to.offsetTop - from.offsetTop}px`);
      ghost.style.width = `${from.offsetWidth * .53}px`;
      ghost.style.height = `${from.offsetHeight * .53}px`;
      ghost.style.setProperty('--feedback-duration', `${durationMs}ms`);
      appendEffect(board, ghost);
      continue;
    }
    const tile = atTile(board, effect.position);
    if (!tile) continue;
    const marker = document.createElement('span');
    marker.className = `presentation-effect ${effect.type}-feedback`;
    marker.style.left = `${tile.offsetLeft}px`;
    marker.style.top = `${tile.offsetTop}px`;
    marker.style.width = `${tile.offsetWidth}px`;
    marker.style.height = `${tile.offsetHeight}px`;
    marker.style.setProperty('--feedback-duration', `${durationMs}ms`);
    if (effect.type === 'damage') marker.textContent = `-${effect.amount}`;
    else if (effect.type === 'destroy') marker.textContent = unitTokens[effect.kind];
    appendEffect(board, marker);
  }
}
