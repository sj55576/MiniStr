export const COMMAND_SPEEDS = [0.5, 1, 2, 4] as const;

export type CommandSpeed = typeof COMMAND_SPEEDS[number];

export interface CommandSequenceOptions {
  /** Run immediately when 0 is supplied; otherwise queue the first command. */
  initialDelayMs?: number;
  nextDelayMs: () => number;
  /** Apply one command and return whether another command should be queued. */
  step: () => boolean;
}

/** Owns the one cancellable timer used for command-by-command animation. */
export class CommandScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  cancel(): void {
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  start(options: CommandSequenceOptions): void {
    this.cancel();
    const generation = this.generation;
    const advance = (): void => {
      if (generation !== this.generation) return;
      this.timer = undefined;
      if (!options.step() || generation !== this.generation) return;
      this.timer = setTimeout(advance, options.nextDelayMs());
    };
    if (options.initialDelayMs === 0) advance();
    else this.timer = setTimeout(advance, options.initialDelayMs ?? options.nextDelayMs());
  }
}
