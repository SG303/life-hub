import type { Db } from '../../core/db.js';
import { HttpError } from '../../core/http.js';
import { civilToday, isCivilDate, nowIso } from '../../core/time.js';

export interface Task {
  id: number;
  title: string;
  note: string | null;
  dueDate: string | null;
  category: string | null;
  done: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title?: string;
  note?: string | null;
  dueDate?: string | null;
  category?: string | null;
  done?: boolean;
}

export interface TaskFilter {
  status?: 'open' | 'done' | 'all';
  category?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface TaskSummary {
  today: string;
  overdue: Task[];
  dueToday: Task[];
  upcoming: Task[];
  openCount: number;
}

interface TaskRow {
  id: number;
  title: string;
  note: string | null;
  due_date: string | null;
  category: string | null;
  done: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueDate: row.due_date,
    category: row.category,
    done: row.done === 1,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const TASK_LIMITS = { title: 200, note: 4000, category: 60 };

const ORDER = `ORDER BY done ASC, due_date IS NULL ASC, due_date ASC, id DESC`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class TaskService {
  private readonly db: Db;
  private readonly timeZone: string;

  constructor(db: Db, timeZone: string) {
    this.db = db;
    this.timeZone = timeZone;
  }

  list(filter: TaskFilter = {}): { items: Task[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status === 'open') where.push('done = 0');
    if (filter.status === 'done') where.push('done = 1');
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.query) {
      where.push(`(title LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`);
      const like = `%${escapeLike(filter.query)}%`;
      params.push(like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM tasks ${clause}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${clause} ${ORDER} LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as unknown as TaskRow[];
    return { items: rows.map(toTask), total };
  }

  get(id: number): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  }

  require(id: number): Task {
    const task = this.get(id);
    if (!task) throw new HttpError(404, 'task_not_found', 'Aufgabe nicht gefunden.');
    return task;
  }

  categories(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT category FROM tasks WHERE category IS NOT NULL ORDER BY category COLLATE NOCASE')
      .all() as { category: string }[];
    return rows.map((row) => row.category);
  }

  create(input: TaskInput): Task {
    if (!input.title) throw new HttpError(400, 'invalid_field', 'Titel fehlt.');
    validate(input);
    const now = nowIso();
    const done = input.done === true;
    const result = this.db
      .prepare(
        `INSERT INTO tasks (title, note, due_date, category, done, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.note ?? null, input.dueDate ?? null, input.category ?? null, done ? 1 : 0, done ? now : null, now, now);
    return this.require(Number(result.lastInsertRowid));
  }

  update(id: number, input: TaskInput): Task {
    const task = this.require(id);
    if (input.title !== undefined && !input.title) throw new HttpError(400, 'invalid_field', 'Titel fehlt.');
    validate(input);
    const now = nowIso();
    const done = input.done ?? task.done;
    const completedAt = done ? (task.done ? task.completedAt : now) : null;
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, note = ?, due_date = ?, category = ?, done = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title ?? task.title,
        input.note !== undefined ? input.note : task.note,
        input.dueDate !== undefined ? input.dueDate : task.dueDate,
        input.category !== undefined ? input.category : task.category,
        done ? 1 : 0,
        completedAt,
        now,
        id,
      );
    return this.require(id);
  }

  remove(id: number): void {
    this.require(id);
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  /** Overdue and due-today tasks plus the next open tasks, evaluated in the configured time zone. */
  summary(now: Date = new Date(), upcomingLimit = 5): TaskSummary {
    const today = civilToday(this.timeZone, now);
    const overdue = this.db
      .prepare(`SELECT * FROM tasks WHERE done = 0 AND due_date < ? ORDER BY due_date ASC, id ASC LIMIT 50`)
      .all(today) as unknown as TaskRow[];
    const dueToday = this.db
      .prepare(`SELECT * FROM tasks WHERE done = 0 AND due_date = ? ORDER BY id ASC LIMIT 50`)
      .all(today) as unknown as TaskRow[];
    const upcoming = this.db
      .prepare(
        `SELECT * FROM tasks WHERE done = 0 AND (due_date IS NULL OR due_date > ?)
         ORDER BY due_date IS NULL ASC, due_date ASC, id DESC LIMIT ?`,
      )
      .all(today, upcomingLimit) as unknown as TaskRow[];
    const openCount = (this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE done = 0').get() as { n: number }).n;
    return {
      today,
      overdue: overdue.map(toTask),
      dueToday: dueToday.map(toTask),
      upcoming: upcoming.map(toTask),
      openCount,
    };
  }

  today(now: Date = new Date()): string {
    return civilToday(this.timeZone, now);
  }
}

function validate(input: TaskInput): void {
  if (input.dueDate && !isCivilDate(input.dueDate)) {
    throw new HttpError(400, 'invalid_field', 'Fälligkeitsdatum muss im Format JJJJ-MM-TT sein.');
  }
}
