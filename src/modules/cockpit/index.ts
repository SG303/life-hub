/**
 * Public interface of the cockpit module: aggregates the `Heute` view from
 * summary providers. Future modules add a provider instead of changing this file.
 */
import { Router } from '../../core/http.js';

export interface CockpitProvider {
  /** Stable key in the `/api/v1/cockpit` response, e.g. `tasks`. */
  id: string;
  summary(now: Date): unknown;
}

export interface CockpitModule {
  summary(now?: Date): Record<string, unknown>;
  routes: Router;
}

export function createCockpitModule(providers: CockpitProvider[]): CockpitModule {
  const summary = (now: Date = new Date()) => {
    const result: Record<string, unknown> = { generatedAt: now.toISOString() };
    for (const provider of providers) result[provider.id] = provider.summary(now);
    return result;
  };
  return { summary, routes: new Router().get('/', () => summary()) };
}
