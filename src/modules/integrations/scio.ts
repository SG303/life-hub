import type { Db } from '../../core/db.js';
import { HttpError } from '../../core/http.js';
import { log } from '../../core/log.js';
import { FetchError, type Fetcher } from '../feeds/index.js';

/** Successful summaries are reused for 5 minutes, failures retried after 1 minute. */
export const SCIO_CACHE_MS = 5 * 60_000;
export const SCIO_RETRY_MS = 60_000;
export const SCIO_MAX_DECKS = 8;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const URL_MAX = 500;

export interface ScioSettings {
  enabled: boolean;
  url: string | null;
}

export interface ScioDeck {
  id: number;
  title: string;
  subject: string | null;
  /** Reviews due now plus new cards available today. */
  due: number;
  dueReviews: number;
  newAvailable: number;
  studyUrl: string;
}

export interface ScioData {
  dueToday: number;
  reviewsToday: number;
  dailyGoal: number;
  currentStreak: number;
  deckCount: number;
  /** Decks with due cards, most due first, at most `SCIO_MAX_DECKS`. */
  decks: ScioDeck[];
  decksUrl: string;
}

export type ScioSummary =
  | { enabled: false }
  | {
      enabled: true;
      /** `error` keeps the last good `data` (if any) and says why the refresh failed. */
      state: 'ok' | 'error';
      error: string | null;
      /** When `data` was fetched successfully. */
      updatedAt: string | null;
      data: ScioData | null;
    };

interface Cache {
  url: string;
  data: ScioData | null;
  updatedAt: string | null;
  error: string | null;
  attemptAt: number;
}

/** Normalises a user-entered Scio base address; throws a 400 for anything that is not a plain http(s) URL. */
export function normalizeScioUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, 'invalid_field', 'Bitte die Adresse von Scio eintragen.');
  }
  const value = raw.trim();
  if (value.length > URL_MAX) throw new HttpError(400, 'invalid_field', `Die Adresse ist zu lang (max. ${URL_MAX} Zeichen).`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'invalid_field', 'Die Adresse muss mit http:// oder https:// beginnen.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'invalid_field', 'Die Adresse muss mit http:// oder https:// beginnen.');
  }
  if (url.username || url.password) throw new HttpError(400, 'invalid_field', 'Zugangsdaten in der Adresse sind nicht erlaubt.');
  if (url.search || url.hash) throw new HttpError(400, 'invalid_field', 'Bitte nur die Grundadresse von Scio eintragen.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function failureMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof FetchError) {
    if (error.reason === 'timeout') return 'Scio antwortet nicht (Zeitüberschreitung).';
    if (error.reason === 'blocked' || error.reason === 'scheme') return 'Diese Adresse ist nicht erlaubt.';
    if (error.reason === 'too_large') return 'Die Antwort von Scio ist zu gross.';
    return 'Scio ist nicht erreichbar.';
  }
  return 'Scio ist nicht erreichbar.';
}

const count = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0);
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Read-only client for a Scio instance (github.com/SG303/scio): due flashcards per deck, streak and daily goal. */
export class ScioService {
  private readonly db: Db;
  private readonly fetcher: Fetcher;
  private cache: Cache | undefined;
  private pending: Promise<void> | undefined;

  constructor(db: Db, fetcher: Fetcher) {
    this.db = db;
    this.fetcher = fetcher;
  }

  getSettings(): ScioSettings {
    const rows = this.db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('scio_enabled', 'scio_url')")
      .all() as { key: string; value: string }[];
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const url = map.get('scio_url') || null;
    return { enabled: map.get('scio_enabled') === '1' && url !== null, url };
  }

  setSettings(patch: { enabled?: boolean; url?: string | null }): ScioSettings {
    const current = this.getSettings();
    const url = patch.url === undefined ? current.url : patch.url === null || patch.url === '' ? null : normalizeScioUrl(patch.url);
    const enabled = patch.enabled ?? current.enabled;
    if (enabled && !url) throw new HttpError(400, 'invalid_field', 'Bitte zuerst die Adresse von Scio eintragen.');
    const upsert = this.db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    upsert.run('scio_enabled', enabled ? '1' : '0');
    upsert.run('scio_url', url ?? '');
    if (this.cache?.url !== url || !enabled) this.cache = undefined;
    return { enabled, url };
  }

  /** Tests an address without saving it; returns the number of decks found. */
  async check(rawUrl: unknown): Promise<{ deckCount: number }> {
    const url = normalizeScioUrl(rawUrl);
    try {
      const decks = await this.getJson(url, '/api/flashcards/decks');
      if (!Array.isArray(decks)) throw this.notScio();
      return { deckCount: decks.length };
    } catch (error) {
      throw new HttpError(502, 'scio_unreachable', failureMessage(error));
    }
  }

  /** Summary for the `Heute` view; refreshes from Scio when the cached one is older than the cache window. */
  async summary(now: Date = new Date()): Promise<ScioSummary> {
    const settings = this.getSettings();
    if (!settings.enabled || !settings.url) return { enabled: false };
    const url = settings.url;
    const cache = this.cache?.url === url ? this.cache : undefined;
    const maxAge = cache?.error ? SCIO_RETRY_MS : SCIO_CACHE_MS;
    if (!cache || now.getTime() - cache.attemptAt >= maxAge) {
      this.pending ??= this.refresh(url, now).finally(() => (this.pending = undefined));
      await this.pending;
    }
    const current = this.cache?.url === url ? this.cache : undefined;
    return {
      enabled: true,
      state: current?.error ? 'error' : 'ok',
      error: current?.error ?? null,
      updatedAt: current?.updatedAt ?? null,
      data: current?.data ?? null,
    };
  }

  private async refresh(url: string, now: Date): Promise<void> {
    const previous = this.cache?.url === url ? this.cache : undefined;
    try {
      const [streak, decks, subjects] = await Promise.all([
        this.getJson(url, '/api/flashcards/streak'),
        this.getJson(url, '/api/flashcards/decks'),
        // Subject names are a nicety: without them the cards just show no subject.
        this.getJson(url, '/api/subjects').catch(() => []),
      ]);
      this.cache = { url, data: this.parse(url, streak, decks, subjects), updatedAt: now.toISOString(), error: null, attemptAt: now.getTime() };
    } catch (error) {
      const message = failureMessage(error);
      log.warn('scio refresh failed', { reason: error instanceof FetchError ? error.reason : message });
      this.cache = { url, data: previous?.data ?? null, updatedAt: previous?.updatedAt ?? null, error: message, attemptAt: now.getTime() };
    }
  }

  private notScio(): HttpError {
    return new HttpError(502, 'scio_invalid', 'Unter dieser Adresse antwortet kein Scio.');
  }

  private async getJson(base: string, path: string): Promise<unknown> {
    const origin = new URL(base).origin;
    const result = await this.fetcher(`${base}${path}`, {
      allowPrivate: true,
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: { Accept: 'application/json' },
      maxRedirects: 2,
      allowRedirect: (next) => next.origin === origin,
    });
    if (result.status === 404) throw this.notScio();
    if (result.status < 200 || result.status >= 300) {
      throw new HttpError(502, 'scio_status', `Scio antwortet mit Fehler ${result.status}.`);
    }
    try {
      return JSON.parse(result.body) as unknown;
    } catch {
      throw this.notScio();
    }
  }

  private parse(base: string, streakRaw: unknown, decksRaw: unknown, subjectsRaw: unknown): ScioData {
    const streak = record(streakRaw);
    if (!streak || !Array.isArray(decksRaw)) throw this.notScio();
    const subjects = new Map<number, string>();
    if (Array.isArray(subjectsRaw)) {
      for (const raw of subjectsRaw) {
        const subject = record(raw);
        if (subject && Number.isSafeInteger(subject.id) && typeof subject.title === 'string') {
          subjects.set(subject.id as number, subject.title.slice(0, 120));
        }
      }
    }
    const decks: ScioDeck[] = [];
    for (const raw of decksRaw) {
      const deck = record(raw);
      if (!deck || !Number.isSafeInteger(deck.id) || (deck.id as number) <= 0 || typeof deck.title !== 'string') continue;
      const dueReviews = count(deck.due_reviews);
      const newAvailable = count(deck.new_available);
      if (dueReviews + newAvailable === 0) continue;
      const id = deck.id as number;
      decks.push({
        id,
        title: deck.title.slice(0, 120),
        subject: Number.isSafeInteger(deck.subject_id) ? (subjects.get(deck.subject_id as number) ?? null) : null,
        due: dueReviews + newAvailable,
        dueReviews,
        newAvailable,
        studyUrl: `${base}/flashcards/${id}/study`,
      });
    }
    decks.sort((a, b) => b.due - a.due || a.title.localeCompare(b.title, 'de-CH'));
    return {
      dueToday: count(streak.due_today),
      reviewsToday: count(streak.reviews_today),
      dailyGoal: count(streak.daily_goal),
      currentStreak: count(streak.current_streak),
      deckCount: decksRaw.length,
      decks: decks.slice(0, SCIO_MAX_DECKS),
      decksUrl: `${base}/flashcards`,
    };
  }
}
