import { describe, expect, it } from 'vitest';
import { defaultSoundSettings, loadSoundSettings, saveSoundSettings, SOUND_SETTINGS_KEY } from './sound';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), values };
}

describe('sound settings', () => {
  it('uses safe defaults for missing or malformed values', () => {
    expect(loadSoundSettings(storage())).toEqual(defaultSoundSettings);
    expect(loadSoundSettings(storage({ [SOUND_SETTINGS_KEY]: '{oops' }))).toEqual(defaultSoundSettings);
    expect(loadSoundSettings(storage({ [SOUND_SETTINGS_KEY]: '{"muted":false,"volume":2}' }))).toEqual(defaultSoundSettings);
  });

  it('persists valid settings without touching game saves', () => {
    const target = storage();
    expect(saveSoundSettings(target, { muted: true, volume: .2 })).toBe(true);
    expect(loadSoundSettings(target)).toEqual({ muted: true, volume: .2 });
  });
});
