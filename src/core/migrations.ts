/**
 * Forward-only schema migrations. Never edit a released migration; add a new one.
 * Each runs in its own transaction and bumps `PRAGMA user_version`.
 */
export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT,
        due_date TEXT,
        category TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX tasks_open_due ON tasks (done, due_date);

      CREATE TABLE feed_sources (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        site_url TEXT,
        type TEXT NOT NULL CHECK (type IN ('news', 'video', 'podcast')),
        type_auto INTEGER NOT NULL DEFAULT 0,
        etag TEXT,
        last_modified TEXT,
        last_fetched_at TEXT,
        last_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE feed_items (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES feed_sources (id) ON DELETE CASCADE,
        dedup_key TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        summary TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        fetched_at TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        is_bookmarked INTEGER NOT NULL DEFAULT 0,
        UNIQUE (source_id, dedup_key)
      );
      CREATE INDEX feed_items_listing ON feed_items (is_read, published_at);

      CREATE TABLE feed_seen_items (
        source_id INTEGER NOT NULL REFERENCES feed_sources (id) ON DELETE CASCADE,
        dedup_key TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (source_id, dedup_key)
      );

      CREATE TABLE chat_threads (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        context_type TEXT CHECK (context_type IN ('task', 'feed_item')),
        context_ref_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX chat_messages_thread ON chat_messages (thread_id, id);
    `,
  },
  {
    // Chat list states (pinned, snoozed, settled), modelled on T3 Code's thread list.
    version: 2,
    sql: `
      ALTER TABLE chat_threads ADD COLUMN pinned_at TEXT;
      ALTER TABLE chat_threads ADD COLUMN snoozed_until TEXT;
      ALTER TABLE chat_threads ADD COLUMN settled_at TEXT;
      ALTER TABLE chat_threads ADD COLUMN unsettled_at TEXT;
      ALTER TABLE chat_threads ADD COLUMN auto_settle INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    // Persisted tool-call trace per completed assistant reply.
    version: 3,
    sql: `
      ALTER TABLE chat_messages ADD COLUMN tool_trace TEXT;
    `,
  },
];
