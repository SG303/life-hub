<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { api, type ChatContext, type ChatMessage, type ChatThread } from '../lib/api';
  import { ago } from '../lib/format';
  import { renderMarkdown } from '../lib/markdown';
  import { router } from '../lib/router.svelte';

  let threads = $state<ChatThread[]>([]);
  let thread = $state<ChatThread | undefined>();
  let messages = $state<ChatMessage[]>([]);
  let status = $state<{ configured: boolean; model: string | null; reachable: boolean | null } | undefined>();
  let context = $state<(ChatContext & { title: string; text: string }) | undefined>();
  let draft = $state('');
  /** Threads with a turn in flight from this view, and whether a new thread is being created. */
  let sendingIds = $state<number[]>([]);
  let creating = $state(false);
  let error = $state('');
  let composer = $state<HTMLTextAreaElement>();
  let log = $state<HTMLElement>();
  const wide = window.matchMedia('(min-width: 900px)').matches;

  const threadId = $derived(Number(router.params.get('thread')) || undefined);
  const contextParam = $derived(router.params.get('kontext'));
  const sending = $derived(creating || (thread !== undefined && sendingIds.includes(thread.id)));
  const pending = $derived(sending || Boolean(thread?.pending));

  async function loadThreads() {
    try {
      threads = (await api.threads()).items;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // The route is the authority for which thread is shown: results for a thread
  // the user has left in the meantime are dropped.
  async function loadThread(id: number) {
    try {
      const state = await api.thread(id);
      if (threadId !== id) return;
      thread = state.thread;
      messages = state.messages;
      error = '';
    } catch (e) {
      if (threadId === id) error = (e as Error).message;
    }
  }

  $effect(() => {
    void loadThreads();
    api.agentStatus().then((s) => (status = s), () => (status = undefined));
  });

  $effect(() => {
    const id = threadId;
    if (id) {
      // A thread just created by send() is already shown; its reply arrives with the send result.
      if (untrack(() => sendingIds.includes(id) && thread?.id === id)) return;
      void loadThread(id);
    } else {
      thread = undefined;
      messages = [];
    }
  });

  $effect(() => {
    const param = contextParam;
    context = undefined;
    const match = param ? /^(task|feed_item):(\d+)$/.exec(param) : null;
    if (!match) return;
    const ctx: ChatContext = { type: match[1] as ChatContext['type'], id: Number(match[2]) };
    api.context(ctx).then(
      (snapshot) => {
        context = { ...ctx, ...snapshot };
        composer?.focus();
      },
      (e: Error) => (error = e.message),
    );
  });

  // While a reply is pending on the server (e.g. after a reload), poll until it arrives.
  $effect(() => {
    if (!thread?.pending || sending) return;
    const id = thread.id;
    const timer = setInterval(() => void loadThread(id), 2000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void messages.length;
    void pending;
    log?.scrollTo({ top: log.scrollHeight });
  });

  async function send(event?: SubmitEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    creating = true;
    error = '';
    const ctx = context ? { type: context.type, id: context.id } : undefined;
    let targetId: number | undefined;
    let failure: Error | undefined;
    try {
      let target = thread;
      if (!target || ctx) {
        target = await api.createThread(ctx);
        sendingIds = [...sendingIds, target.id];
        thread = target;
        messages = [];
        router.go(`/chat?thread=${target.id}`, { replace: true });
      }
      targetId = target.id;
      if (!sendingIds.includes(target.id)) sendingIds = [...sendingIds, target.id];
      creating = false;
      const preview = context ? `${content}\n\n---\n${context.text}` : content;
      messages = [...messages, { id: -1, threadId: target.id, role: 'user', content: preview, createdAt: new Date().toISOString() }];
      draft = '';
      context = undefined;
      const state = await api.send(target.id, content, ctx);
      if (threadId === target.id) {
        thread = state.thread;
        messages = state.messages;
      }
    } catch (e) {
      failure = e as Error;
    } finally {
      creating = false;
      sendingIds = sendingIds.filter((id) => id !== targetId);
      void loadThreads();
    }
    if (failure && (targetId === undefined || targetId === threadId)) {
      error = failure.message;
      if (targetId !== undefined) await loadThread(targetId);
    }
  }

  async function retry() {
    if (!thread) return;
    const id = thread.id;
    sendingIds = [...sendingIds, id];
    error = '';
    messages = messages.filter((message) => message.role !== 'error');
    let failure: Error | undefined;
    try {
      const state = await api.retry(id);
      if (threadId === id) {
        thread = state.thread;
        messages = state.messages;
      }
    } catch (e) {
      failure = e as Error;
    } finally {
      sendingIds = sendingIds.filter((other) => other !== id);
    }
    if (failure && threadId === id) {
      error = failure.message;
      await loadThread(id);
    }
  }

  async function removeThread(target: ChatThread) {
    try {
      await api.deleteThread(target.id);
      if (thread?.id === target.id) router.go('/chat', { replace: true });
      await loadThreads();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function open(event: MouseEvent, path: string) {
    event.preventDefault();
    router.go(path);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
  }
</script>

<header class="page-head">
  <h1>Chat</h1>
  <div class="toolbar">
    {#if status}
      <p class="agent-status meta" data-testid="agent-status">
        {#if !status.configured}
          Kein Agent konfiguriert.
        {:else}
          <span class="dot" class:up={status.reachable} aria-hidden="true"></span>
          {status.model}, {status.reachable ? 'erreichbar' : 'nicht erreichbar'}
        {/if}
      </p>
    {/if}
    <a class="button" href="/chat" onclick={(e) => open(e, '/chat')}><Icon name="plus" size={18} />Neuer Chat</a>
  </div>
</header>

<div class="layout">
  <details class="history" open={wide}>
    <summary>Verlauf ({threads.length})</summary>
    {#if threads.length}
      <ul>
        {#each threads as item (item.id)}
          <li class:current={item.id === thread?.id}>
            <a href="/chat?thread={item.id}" onclick={(e) => open(e, `/chat?thread=${item.id}`)}>
              <span class="thread-title">{item.title}</span>
              <span class="meta">{ago(item.updatedAt)}</span>
            </a>
            <button class="button quiet" type="button" onclick={() => removeThread(item)} aria-label="Chat löschen: {item.title}">
              <Icon name="trash" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">Noch keine Chats.</p>
    {/if}
  </details>

  <section class="conversation" aria-label="Unterhaltung">
    <div class="log" bind:this={log} aria-live="polite">
      {#if !messages.length && !pending}
        <p class="empty intro">
          Frag den Agenten zu deinen Aufgaben und Feeds. Er kann sie über die Life-Hub-Schnittstelle lesen, aber nichts ändern.
        </p>
      {/if}
      {#each messages as message (message.id)}
        {#if message.role === 'user'}
          <div class="message user" data-testid="message-user"><p>{message.content}</p></div>
        {:else if message.role === 'assistant'}
          <!-- Assistant replies go only through the sanitizing renderer (no raw HTML, no images, http(s) links only). -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="message assistant" data-testid="message-assistant">{@html renderMarkdown(message.content)}</div>
        {:else}
          <div class="notice error message-error" role="alert" data-testid="message-error">
            <p>{message.content}</p>
            {#if message === messages.at(-1)}
              <button class="button" type="button" onclick={retry} disabled={pending}><Icon name="refresh" size={18} />Erneut versuchen</button>
            {/if}
          </div>
        {/if}
      {/each}
      {#if pending}
        <p class="thinking" role="status">Agent antwortet …</p>
      {/if}
    </div>

    {#if error}<p class="notice error" role="alert">{error}</p>{/if}

    <form class="composer" onsubmit={send}>
      {#if context}
        <div class="context" data-testid="chat-context">
          <div class="context-head">
            <span>Wird mitgesendet: {context.type === 'task' ? 'Aufgabe' : 'Feed-Eintrag'} «{context.title}»</span>
            <button
              class="button quiet"
              type="button"
              aria-label="Kontext entfernen"
              onclick={() => router.go(thread ? `/chat?thread=${thread.id}` : '/chat', { replace: true })}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <pre>{context.text}</pre>
        </div>
      {/if}
      <label class="visually-hidden" for="chat-input">Nachricht</label>
      <textarea
        id="chat-input"
        class="input"
        bind:this={composer}
        bind:value={draft}
        onkeydown={keydown}
        maxlength="8000"
        rows="3"
        placeholder={context ? 'Was möchtest du dazu wissen?' : 'Nachricht an den Agenten'}
      ></textarea>
      <div class="send-row">
        <span class="meta">Strg+Enter sendet</span>
        <button class="button primary" type="submit" disabled={pending || !draft.trim()}>Senden</button>
      </div>
    </form>
  </section>
</div>

<style>
  .agent-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
  }

  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--contour);
  }

  .dot.up {
    background: var(--forest);
  }

  .layout {
    display: grid;
    gap: 1rem;
  }

  .history summary {
    cursor: pointer;
    font-weight: 620;
    padding: 0.4rem 0;
  }

  .history ul {
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    max-height: 16rem;
    overflow-y: auto;
  }

  .history li {
    display: flex;
    align-items: center;
    border-radius: var(--radius-s);
  }

  .history li.current {
    background: var(--lake-wash);
  }

  .history a {
    flex: 1;
    min-width: 0;
    display: grid;
    padding: 0.45rem 0.6rem;
    color: var(--ink);
    text-decoration: none;
  }

  .thread-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }

  .log {
    display: grid;
    gap: 0.9rem;
    align-content: start;
    min-height: 12rem;
    max-height: 60dvh;
    overflow-y: auto;
    padding: 0.25rem 0.1rem;
  }

  .intro {
    max-width: 48ch;
  }

  .message {
    max-width: min(46rem, 92%);
    overflow-wrap: anywhere;
  }

  .message.user {
    justify-self: end;
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius-m) var(--radius-m) 4px var(--radius-m);
    background: var(--lake);
    color: var(--lake-ink);
  }

  .message.user p {
    margin: 0;
    white-space: pre-wrap;
  }

  .message.assistant {
    justify-self: start;
    padding: 0.1rem 0 0.1rem 0.9rem;
    border-left: 3px solid var(--rule);
  }

  .message.assistant :global(p) {
    margin: 0.4rem 0;
  }

  .message.assistant :global(pre) {
    overflow-x: auto;
    padding: 0.6rem;
    border-radius: var(--radius-s);
    background: var(--sheet);
  }

  .message-error p {
    margin: 0 0 0.5rem;
  }

  .thinking {
    margin: 0;
    color: var(--ink-soft);
  }

  .composer {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius-m);
    background: var(--sheet);
  }

  .context {
    border-left: 3px solid var(--lake);
    padding-left: 0.75rem;
  }

  .context-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-weight: 600;
  }

  .context pre {
    margin: 0.25rem 0 0;
    max-height: 9rem;
    overflow: auto;
    font-family: var(--font);
    font-size: var(--step--1);
    color: var(--ink-soft);
    white-space: pre-wrap;
  }

  .send-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  @media (min-width: 900px) {
    .layout {
      grid-template-columns: 15rem 1fr;
      align-items: start;
    }

    .history summary {
      pointer-events: none;
      list-style: none;
    }

    .history ul {
      max-height: 70dvh;
    }
  }
</style>
