import type { TimerAdapter } from "./types.js";

/** A queued API call */
interface QueuedCall {
  /** Function to execute */
  execute: () => Promise<void>;
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Rate limiter for Govee Cloud API calls.
 * Respects per-minute and daily limits, queues excess calls.
 */
export class RateLimiter {
  private readonly log: ioBroker.Logger;
  private readonly timers: TimerAdapter;
  private readonly queue: QueuedCall[] = [];
  private processTimer: ioBroker.Interval | undefined = undefined;
  private callsThisMinute = 0;
  private callsToday = 0;
  private minuteResetTimer: ioBroker.Interval | undefined = undefined;
  private dayResetTimer: ioBroker.Interval | undefined = undefined;
  private dayResetKickoff: ioBroker.Timeout | undefined = undefined;

  /** Max calls per minute */
  private perMinuteLimit: number;
  /** Max calls per day (with safety buffer) */
  private perDayLimit: number;

  /**
   * @param log ioBroker logger
   * @param timers Timer adapter
   * @param perMinuteLimit Max calls per minute (default 4, conservative for shared API key with govee-smart)
   * @param perDayLimit Max calls per day (default 4000, shares 10000 budget with govee-smart)
   */
  constructor(
    log: ioBroker.Logger,
    timers: TimerAdapter,
    perMinuteLimit = 4,
    perDayLimit = 4000,
  ) {
    this.log = log;
    this.timers = timers;
    this.perMinuteLimit = perMinuteLimit;
    this.perDayLimit = perDayLimit;
  }

  /**
   * Update rate limits dynamically (e.g. when sibling adapter starts/stops).
   *
   * @param perMinuteLimit Max calls per minute
   * @param perDayLimit Max calls per day
   */
  updateLimits(perMinuteLimit: number, perDayLimit: number): void {
    this.perMinuteLimit = perMinuteLimit;
    this.perDayLimit = perDayLimit;
  }

  /** Start the rate limiter — resets counters periodically */
  start(): void {
    this.minuteResetTimer = this.timers.setInterval(() => {
      this.callsThisMinute = 0;
      this.processQueue();
    }, 60_000);

    // Daily reset aligned to UTC midnight — Govee's server-side quota flips
    // at 00:00 UTC. A plain 24h-from-start timer would drift and waste
    // budget (e.g. adapter started at 18:00 would keep a stale counter
    // until 18:00 the next day even though Govee already reset at 00:00).
    const msUntilMidnight = this.millisUntilNextUtcMidnight();
    this.dayResetKickoff = this.timers.setTimeout(() => {
      this.resetDaily();
      this.dayResetTimer = this.timers.setInterval(
        () => this.resetDaily(),
        86_400_000,
      );
    }, msUntilMidnight);

    this.processTimer = this.timers.setInterval(() => {
      this.processQueue();
    }, 2_000);
  }

  /** Stop the rate limiter */
  stop(): void {
    if (this.minuteResetTimer) {
      this.timers.clearInterval(this.minuteResetTimer);
      this.minuteResetTimer = undefined;
    }
    if (this.dayResetKickoff) {
      this.timers.clearTimeout(this.dayResetKickoff);
      this.dayResetKickoff = undefined;
    }
    if (this.dayResetTimer) {
      this.timers.clearInterval(this.dayResetTimer);
      this.dayResetTimer = undefined;
    }
    if (this.processTimer) {
      this.timers.clearInterval(this.processTimer);
      this.processTimer = undefined;
    }
    this.queue.length = 0;
  }

  /** Zero the daily counter and log. Separate so kickoff + interval share it. */
  private resetDaily(): void {
    this.log.debug(
      `Rate limiter: daily reset (used ${this.callsToday} calls today)`,
    );
    this.callsToday = 0;
  }

  /** Milliseconds from now until the next UTC midnight tick. */
  private millisUntilNextUtcMidnight(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    return next.getTime() - now.getTime();
  }

  /**
   * Enqueue an API call. It will be executed when rate limits allow.
   *
   * @param execute Function to execute
   * @param priority Queue priority (lower = higher)
   */
  enqueue(execute: () => Promise<void>, priority = 1): void {
    this.queue.push({ execute, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Execute immediately if within limits, otherwise queue.
   * Returns true if executed immediately.
   *
   * @param execute Function to execute
   * @param priority Queue priority (lower = higher)
   */
  async tryExecute(
    execute: () => Promise<void>,
    priority = 0,
  ): Promise<boolean> {
    if (this.canMakeCall()) {
      this.callsThisMinute++;
      this.callsToday++;
      await execute();
      return true;
    }
    this.enqueue(execute, priority);
    return false;
  }

  /** Whether a call can be made right now */
  canMakeCall(): boolean {
    return (
      this.callsThisMinute < this.perMinuteLimit &&
      this.callsToday < this.perDayLimit
    );
  }

  /**
   * Record an external API call against the budget without queueing.
   * Used for callers that must run immediately (e.g. startup discovery).
   */
  recordCall(): void {
    this.callsThisMinute++;
    this.callsToday++;
  }

  /** Current daily usage */
  get dailyUsage(): number {
    return this.callsToday;
  }

  /** Process queued calls */
  private processQueue(): void {
    while (this.queue.length > 0 && this.canMakeCall()) {
      const call = this.queue.shift();
      if (call) {
        this.callsThisMinute++;
        this.callsToday++;
        call.execute().catch((err) => {
          this.log.debug(
            `Queued call failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }
  }
}
