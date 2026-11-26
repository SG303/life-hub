/** Typed client for the `/api/v1` JSON API. The UI talks to the backend only through this module. */

export type FeedType = 'news' | 'video' | 'podcast';
export type BookmarkExpiryDays = 7 | 14 | 30 | null;

export interface FeedSettings {
  bookmarkExpiryDays: BookmarkExpiryDays;
}

export interface ItemStatePatch {
  read?: boolean;
  bookmarked?: boolean;
  bookmarkExpiry?: 'extend' | 'permanent' | string | null;
}

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

export interface FeedSource {
  id: number;
  title: string;
  url: string;
  siteUrl: string | null;
  type: FeedType;
  lastFetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  itemCount: number;
  unreadCount: number;
}

export interface FeedItem {
  id: number;
  sourceId: number;
  sourceTitle: string;
  type: FeedType;
  title: string;
  url: string | null;
  summary: string;
  publishedAt: string | null;
  fetchedAt: string;
  read: boolean;
  bookmarked: boolean;
  bookmarkExpiresAt: string | null;
  bookmarkExpired: boolean;
}

export interface ChatThread {
  id: number;
  title: string;
  contextType: 'task' | 'feed_item' | null;
  contextRefId: number | null;
  createdAt: string;
  updatedAt: string;
  pending: boolean;
  state: 'pinned' | 'active' | 'snoozed' | 'settled';
  snoozedUntil: string | null;
  woke: boolean;
  settledAt: string | null;
  autoSettle: boolean;
}

export interface ThreadPatch {
  title?: string;
  pinned?: boolean;
  snoozedUntil?: string | null;
  settled?: boolean;
  autoSettle?: boolean;
}

export interface ToolTraceStep {
  id: string;
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
  source: 'mcp' | 'agent';
}

export interface ChatMessage {
  id: number;
  threadId: number;
  role: 'user' | 'assistant' | 'error';
  content: string;
  toolTrace: ToolTraceStep[];
  createdAt: string;
}

export interface Cockpit {
  generatedAt: string;
  tasks: { today: string; overdue: Task[]; dueToday: Task[]; upcoming: Task[]; openCount: number };
  feeds: Record<FeedType, { items: FeedItem[]; unreadCount: number }> & {
    expiredBookmarks: { items: FeedItem[]; total: number; defaultExpiryDays: BookmarkExpiryDays };
  };
}

export interface ChatContext {
  type: 'task' | 'feed_item';
  id: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Life Hub ist nicht erreichbar. Bitte Verbindung prüfen.');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
  if (!response.ok) throw new ApiError(response.status, data?.error?.message ?? `Fehler ${response.status}`);
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === '') continue;
    search.set(key, value === true ? '1' : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'note' | 'dueDate' | 'category' | 'done'>>;

export const api = {
  health: () => request<{ status: string; version: string }>('GET', '/health'),
  cockpit: () => request<Cockpit>('GET', '/cockpit'),

  tasks: (filter: { status?: string; category?: string; q?: string } = {}) =>
    request<{ items: Task[]; total: number; today: string }>('GET', `/tasks${query(filter)}`),
  categories: () => request<{ items: string[] }>('GET', '/tasks/categories'),
  createTask: (task: TaskPatch) => request<Task>('POST', '/tasks', task),
  updateTask: (id: number, patch: TaskPatch) => request<Task>('PATCH', `/tasks/${id}`, patch),
  deleteTask: (id: number) => request<void>('DELETE', `/tasks/${id}`),

  feedSettings: () => request<FeedSettings>('GET', '/feeds/settings'),
  updateFeedSettings: (settings: FeedSettings) => request<FeedSettings>('PATCH', '/feeds/settings', settings),
  sources: () => request<{ items: FeedSource[]; refreshing: boolean }>('GET', '/feeds/sources'),
  addSource: (source: { url: string; type?: FeedType; title?: string }) => request<FeedSource>('POST', '/feeds/sources', source),
  updateSource: (id: number, patch: { url?: string; type?: FeedType; title?: string }) =>
    request<FeedSource>('PATCH', `/feeds/sources/${id}`, patch),
  deleteSource: (id: number) => request<void>('DELETE', `/feeds/sources/${id}`),
  importOpml: (opml: string) => request<{ added: number; skipped: number; invalid: number }>('POST', '/feeds/opml', { opml }),
  refresh: () => request<{ refreshed: number; failed: number; newItems: number }>('POST', '/feeds/refresh', {}),
  items: (filter: { type?: FeedType; unread?: boolean; bookmarked?: boolean; expired?: boolean; limit?: number; offset?: number }) =>
    request<{ items: FeedItem[]; total: number }>('GET', `/feeds/items${query(filter)}`),
  updateItem: (id: number, state: ItemStatePatch) => request<FeedItem>('PATCH', `/feeds/items/${id}`, state),
  markAllRead: (type?: FeedType) => request<{ updated: number }>('POST', '/feeds/items/mark-read', { type }),

  agentStatus: () => request<{ configured: boolean; model: string | null; reachable: boolean | null }>('GET', '/chat/status'),
  context: (ctx: ChatContext) => request<{ title: string; text: string }>('GET', `/chat/context${query({ type: ctx.type, id: ctx.id })}`),
  threads: () => request<{ items: ChatThread[] }>('GET', '/chat/threads'),
  createThread: (context?: ChatContext) => request<ChatThread>('POST', '/chat/threads', { context }),
  thread: (id: number) => request<{ thread: ChatThread; messages: ChatMessage[] }>('GET', `/chat/threads/${id}`),
  updateThread: (id: number, patch: ThreadPatch) => request<ChatThread>('PATCH', `/chat/threads/${id}`, patch),
  deleteThread: (id: number) => request<void>('DELETE', `/chat/threads/${id}`),
  send: (id: number, content: string, context?: ChatContext) =>
    request<{ thread: ChatThread; messages: ChatMessage[] }>('POST', `/chat/threads/${id}/messages`, { content, context }),
  startSend: (id: number, content: string, context?: ChatContext) =>
    request<{ thread: ChatThread; messages: ChatMessage[] }>('POST', `/chat/threads/${id}/messages`, { content, context, async: true }),
  retry: (id: number) => request<{ thread: ChatThread; messages: ChatMessage[] }>('POST', `/chat/threads/${id}/retry`, {}),
  startRetry: (id: number) => request<{ thread: ChatThread; messages: ChatMessage[] }>('POST', `/chat/threads/${id}/retry`, { async: true }),
  streamThread: (
    id: number,
    handlers: {
      onSnapshot: (text: string, steps: ToolTraceStep[]) => void;
      onDelta: (text: string) => void;
      onTool: (step: ToolTraceStep) => void;
      onDone: (state: { thread: ChatThread; messages: ChatMessage[] }) => void;
      onDisconnect?: () => void;
    },
  ): (() => void) => {
    const source = new EventSource(`/api/v1/chat/threads/${id}/stream`);
    let closed = false;
    const stop = () => {
      if (closed) return;
      closed = true;
      source.close();
    };
    const on = (type: string, fn: (data: unknown) => void) => {
      source.addEventListener(type, (event) => {
        if (closed) return;
        try {
          fn(JSON.parse((event as MessageEvent<string>).data));
        } catch {
          // ignore malformed frame
        }
      });
    };
    on('snapshot', (data) => {
      const payload = data as { text: string; steps: ToolTraceStep[] };
      handlers.onSnapshot(payload.text, payload.steps);
    });
    on('delta', (data) => {
      const payload = data as { text: string };
      handlers.onDelta(payload.text);
    });
    on('tool', (data) => {
      const payload = data as { step: ToolTraceStep };
      handlers.onTool(payload.step);
    });
    on('done', (data) => {
      stop();
      handlers.onDone(data as { thread: ChatThread; messages: ChatMessage[] });
    });
    source.onerror = () => {
      if (closed) return;
      if (source.readyState === EventSource.CLOSED) {
        stop();
        handlers.onDisconnect?.();
      }
    };
    return stop;
  },
};
