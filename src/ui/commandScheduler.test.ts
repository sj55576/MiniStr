import { describe, expect, it, vi } from 'vitest';
import { CommandScheduler } from './commandScheduler';

describe('CommandScheduler', () => {
  it('runs one immediate step, then continues at the requested interval', () => {
    vi.useFakeTimers();
    try {
      const scheduler = new CommandScheduler();
      let steps = 0;
      scheduler.start({ initialDelayMs: 0, nextDelayMs: () => 100, step: () => ++steps < 3 });
      expect(steps).toBe(1);
      vi.advanceTimersByTime(99);
      expect(steps).toBe(1);
      vi.advanceTimersByTime(1);
      expect(steps).toBe(2);
      vi.advanceTimersByTime(100);
      expect(steps).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending and replaced sequences', () => {
    vi.useFakeTimers();
    try {
      const scheduler = new CommandScheduler();
      const first = vi.fn(() => true);
      const second = vi.fn(() => false);
      scheduler.start({ nextDelayMs: () => 10, step: first });
      scheduler.start({ nextDelayMs: () => 10, step: second });
      vi.advanceTimersByTime(10);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      scheduler.start({ nextDelayMs: () => 10, step: () => true });
      scheduler.cancel();
      vi.runAllTimers();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
