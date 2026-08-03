import type { StorageLike } from '../game';
import type { SoundEvent } from './presentationEffects';

export interface SoundSettings { muted: boolean; volume: number }
export const SOUND_SETTINGS_KEY = 'ministr.sound.settings';
export const defaultSoundSettings: SoundSettings = { muted: false, volume: .45 };

function isSoundSettings(value: unknown): value is SoundSettings {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { muted?: unknown; volume?: unknown };
  return typeof candidate.muted === 'boolean' && typeof candidate.volume === 'number'
    && Number.isFinite(candidate.volume) && candidate.volume >= 0 && candidate.volume <= 1;
}

export function loadSoundSettings(storage: StorageLike): SoundSettings {
  try {
    const raw = storage.getItem(SOUND_SETTINGS_KEY);
    if (!raw) return { ...defaultSoundSettings };
    const parsed: unknown = JSON.parse(raw);
    return isSoundSettings(parsed) ? parsed : { ...defaultSoundSettings };
  } catch { return { ...defaultSoundSettings }; }
}

export function saveSoundSettings(storage: StorageLike, settings: SoundSettings): boolean {
  if (!isSoundSettings(settings)) return false;
  try { storage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}

type AudioContextConstructor = new () => AudioContext;

/** Web Audio player with no external assets. It remains silent until a user gesture unlocks it. */
export class ProceduralSoundPlayer {
  private context: AudioContext | undefined;
  private constructorRef: AudioContextConstructor | undefined;

  constructor(private settings: SoundSettings, constructorRef?: AudioContextConstructor) {
    this.constructorRef = constructorRef ?? window.AudioContext;
  }

  setSettings(settings: SoundSettings): void { this.settings = settings; }

  async unlock(): Promise<void> {
    if (!this.constructorRef) return;
    this.context ??= new this.constructorRef();
    if (this.context.state !== 'running') {
      try { await this.context.resume(); } catch { /* Autoplay policy: remain silent. */ }
    }
  }

  play(event: SoundEvent): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.settings.muted || this.settings.volume === 0) return;
    const now = context.currentTime;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const profile: Record<SoundEvent, readonly [OscillatorType, number, number, number]> = {
      move: ['sine', 430, 610, .07], attack: ['square', 130, 80, .10], hit: ['triangle', 190, 120, .08],
      destroy: ['sawtooth', 150, 45, .16], capture: ['sine', 340, 700, .14], produce: ['triangle', 300, 500, .12], turn: ['sine', 250, 420, .13],
    };
    const [wave, from, to, duration] = profile[event];
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(Math.min(.18, this.settings.volume * .32), now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
    oscillator.addEventListener('ended', () => { oscillator.disconnect(); gain.disconnect(); }, { once: true });
  }
}
