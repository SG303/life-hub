import { describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase } from '../src/core/db.ts';
import { civilToday, isCivilDate } from '../src/core/time.ts';
import { TaskService } from '../src/modules/tasks/index.ts';
import { tempDir } from './helpers.ts';

describe('civil dates', () => {
  it('evaluates today in Europe/Zurich, not UTC', () => {
    // 23:30 UTC on 2026-11-24 is already 00:30 on 2026-11-25 in Zurich (UTC+1).
    const late = new Date('2026-11-24T23:30:00Z');
    expect(civilToday('Europe/Zurich', late)).toBe('2026-11-25');
    expect(civilToday('UTC', late)).toBe('2026-11-24');
    // Summer time: UTC+2.
    expect(civilToday('Europe/Zurich', new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isCivilDate('2026-02-28')).toBe(true);
    expect(isCivilDate('2026-02-30')).toBe(false);
    expect(isCivilDate('2026-2-3')).toBe(false);
    expect(isCivilDate('28.02.2026')).toBe(false);
  });
});

describe('TaskService', () => {
  it('creates, edits, completes, filters and deletes tasks', () => {
    const tasks = new TaskService(openMemoryDatabase(), 'Europe/Zurich');
    const a = tasks.create({ title: 'Steuern', note: 'Belege sammeln', dueDate: '2026-12-01', category: 'Haushalt' });
    const b = tasks.create({ title: 'Velo flicken', category: 'Freizeit' });
    tasks.create({ title: 'Ohne Liste' });

    expect(tasks.update(a.id, { title: 'Steuererklärung', dueDate: null }).dueDate).toBeNull();
    const done = tasks.update(b.id, { done: true });
    expect(done.done).toBe(true);
    expect(done.completedAt).not.toBeNull();
    expect(tasks.update(b.id, { done: false }).completedAt).toBeNull();
    tasks.update(b.id, { done: true });

    expect(tasks.list({ status: 'open' }).items.map((t) => t.title)).toEqual(['Ohne Liste', 'Steuererklärung']);
    expect(tasks.list({ status: 'done' }).items.map((t) => t.title)).toEqual(['Velo flicken']);
    expect(tasks.list({ category: 'Haushalt' }).items.map((t) => t.title)).toEqual(['Steuererklärung']);
    expect(tasks.list({ query: 'belege' }).total).toBe(1);
    expect(tasks.categories()).toEqual(['Freizeit', 'Haushalt']);

    tasks.remove(a.id);
    expect(tasks.get(a.id)).toBeUndefined();
    expect(() => tasks.remove(a.id)).toThrow(/nicht gefunden/);
  });

  it('rejects invalid due dates and empty titles', () => {
    const tasks = new TaskService(openMemoryDatabase(), 'Europe/Zurich');
    expect(() => tasks.create({ title: 'x', dueDate: '2026-13-01' })).toThrow(/JJJJ-MM-TT/);
    expect(() => tasks.create({ title: '' })).toThrow(/Titel/);
  });

  it('splits overdue, due today and upcoming in the configured time zone', () => {
    const tasks = new TaskService(openMemoryDatabase(), 'Europe/Zurich');
    tasks.create({ title: 'Gestern', dueDate: '2026-11-24' });
    tasks.create({ title: 'Heute', dueDate: '2026-11-25' });
    tasks.create({ title: 'Morgen', dueDate: '2026-11-26' });
    tasks.create({ title: 'Irgendwann' });
    tasks.create({ title: 'Erledigt', dueDate: '2026-11-20', done: true });

    // 23:30 UTC on the 24th is the 25th in Zurich.
    const summary = tasks.summary(new Date('2026-11-24T23:30:00Z'));
    expect(summary.today).toBe('2026-11-25');
    expect(summary.overdue.map((t) => t.title)).toEqual(['Gestern']);
    expect(summary.dueToday.map((t) => t.title)).toEqual(['Heute']);
    expect(summary.upcoming.map((t) => t.title)).toEqual(['Morgen', 'Irgendwann']);
    expect(summary.openCount).toBe(4);
  });

  it('persists tasks across a restart (file database)', () => {
    const dir = tempDir();
    const first = openDatabase(dir);
    new TaskService(first, 'Europe/Zurich').create({ title: 'Bleibt erhalten', dueDate: '2026-12-24' });
    first.close();

    const second = openDatabase(dir);
    const tasks = new TaskService(second, 'Europe/Zurich');
    expect(tasks.list().items.map((t) => [t.title, t.dueDate])).toEqual([['Bleibt erhalten', '2026-12-24']]);
    expect(second.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(second.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    second.close();
  });
});
