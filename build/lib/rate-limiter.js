"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var rate_limiter_exports = {};
__export(rate_limiter_exports, {
  RateLimiter: () => RateLimiter
});
module.exports = __toCommonJS(rate_limiter_exports);
class RateLimiter {
  log;
  timers;
  queue = [];
  processTimer = void 0;
  callsThisMinute = 0;
  callsToday = 0;
  minuteResetTimer = void 0;
  dayResetTimer = void 0;
  /** Max calls per minute */
  perMinuteLimit;
  /** Max calls per day (with safety buffer) */
  perDayLimit;
  /**
   * @param log ioBroker logger
   * @param timers Timer adapter
   * @param perMinuteLimit Max calls per minute (default 4, conservative for shared API key with govee-smart)
   * @param perDayLimit Max calls per day (default 4000, shares 10000 budget with govee-smart)
   */
  constructor(log, timers, perMinuteLimit = 4, perDayLimit = 4e3) {
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
  updateLimits(perMinuteLimit, perDayLimit) {
    this.perMinuteLimit = perMinuteLimit;
    this.perDayLimit = perDayLimit;
  }
  /** Start the rate limiter — resets counters periodically */
  start() {
    this.minuteResetTimer = this.timers.setInterval(() => {
      this.callsThisMinute = 0;
      this.processQueue();
    }, 6e4);
    this.dayResetTimer = this.timers.setInterval(() => {
      this.log.debug(
        `Rate limiter: daily reset (used ${this.callsToday} calls today)`
      );
      this.callsToday = 0;
    }, 864e5);
    this.processTimer = this.timers.setInterval(() => {
      this.processQueue();
    }, 2e3);
  }
  /** Stop the rate limiter */
  stop() {
    if (this.minuteResetTimer) {
      this.timers.clearInterval(this.minuteResetTimer);
      this.minuteResetTimer = void 0;
    }
    if (this.dayResetTimer) {
      this.timers.clearInterval(this.dayResetTimer);
      this.dayResetTimer = void 0;
    }
    if (this.processTimer) {
      this.timers.clearInterval(this.processTimer);
      this.processTimer = void 0;
    }
    this.queue.length = 0;
  }
  /**
   * Enqueue an API call. It will be executed when rate limits allow.
   *
   * @param execute Function to execute
   * @param priority Queue priority (lower = higher)
   */
  enqueue(execute, priority = 1) {
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
  async tryExecute(execute, priority = 0) {
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
  canMakeCall() {
    return this.callsThisMinute < this.perMinuteLimit && this.callsToday < this.perDayLimit;
  }
  /**
   * Record an external API call against the budget without queueing.
   * Used for callers that must run immediately (e.g. startup discovery).
   */
  recordCall() {
    this.callsThisMinute++;
    this.callsToday++;
  }
  /** Current daily usage */
  get dailyUsage() {
    return this.callsToday;
  }
  /** Process queued calls */
  processQueue() {
    while (this.queue.length > 0 && this.canMakeCall()) {
      const call = this.queue.shift();
      if (call) {
        this.callsThisMinute++;
        this.callsToday++;
        call.execute().catch((err) => {
          this.log.debug(
            `Queued call failed: ${err instanceof Error ? err.message : String(err)}`
          );
        });
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RateLimiter
});
//# sourceMappingURL=rate-limiter.js.map
