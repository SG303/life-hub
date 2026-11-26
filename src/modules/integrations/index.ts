/**
 * Public interface of the integrations module: read-only connections to other
 * self-hosted apps («Verbundene Apps»). Currently only Scio.
 */
import type { Db } from '../../core/db.js';
import { HttpError, input, Router } from '../../core/http.js';
import { safeFetch, type Fetcher } from '../feeds/index.js';
import { ScioService } from './scio.js';

export type { ScioData, ScioDeck, ScioSettings, ScioSummary } from './scio.js';
export { ScioService } from './scio.js';

export interface IntegrationsModule {
  scio: ScioService;
  routes: Router;
}

export function createIntegrationsModule(db: Db, fetcher: Fetcher = safeFetch): IntegrationsModule {
  const scio = new ScioService(db, fetcher);
  const routes = new Router()
    .get('/scio', () => scio.summary())
    .get('/scio/settings', () => scio.getSettings())
    .patch('/scio/settings', ({ body }) => {
      const data = input.object(body);
      if (data.url !== undefined && data.url !== null && typeof data.url !== 'string') {
        throw new HttpError(400, 'invalid_field', 'Feld «Adresse» ist ungültig.');
      }
      return scio.setSettings({ enabled: input.boolean(data.enabled, 'Aktiv'), url: data.url as string | null | undefined });
    })
    .post('/scio/check', ({ body }) => scio.check(input.object(body).url));
  return { scio, routes };
}
