import { log } from '../../core/log.js';
import type { FeedService } from './service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Timers for the feed poller and the retention cleanup. On start it catches up
 * overdue sources and prunes once; afterwards it refreshes every
 * `intervalMs` and prunes daily. Overlap is prevented by `FeedService.refreshAll`.
 */
export class FeedScheduler {
  private readonly service: FeedService;
  private readonly intervalMs: number;
  private timers: NodeJS.Timeout[] = [];

  constructor(service: FeedService, intervalMs: number) {
    this.service = service;
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.prune();
    void this.refresh(true);
    this.timers.push(setInterval(() => void this.refresh(false), this.intervalMs));
    this.timers.push(setInterval(() => this.prune(), DAY_MS));
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async refresh(onlyDue: boolean): Promise<void> {
    try {
      const result = await this.service.refreshAll({ onlyDue });
      log.info('feeds refreshed', { ...result, onlyDue });
    } catch (error) {
      log.error('feed refresh crashed', { error: String(error) });
    }
  }

  private prune(): void {
    try {
      const result = this.service.pruneRetention();
      if (result.items) log.info('feed retention cleanup', result);
    } catch (error) {
      log.error('feed retention cleanup failed', { error: String(error) });
    }
  }
}
