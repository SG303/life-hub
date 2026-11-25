<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import SwipeRow from '../components/SwipeRow.svelte';
  import ThreadMenu from '../components/ThreadMenu.svelte';
  import UndoToast from '../components/UndoToast.svelte';
  import { api, type ChatContext, type ChatMessage, type ChatThread, type ToolTraceStep } from '../lib/api';
  import { ago } from '../lib/format';
  import { renderMarkdown } from '../lib/markdown';
  import { router } from '../lib/router.svelte';
  import { wakeLabel } from '../lib/snooze';
  import { threadUndoPatch } from '../lib/swipe';

  const SETTLED_PAGE = 20;

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
  let menuThread = $state<ChatThread | undefined>();
  let menuInitialView = $state<'main' | 'snooze'>('main');
  let menuOpen = $state(false);
  let openSwipeId = $state<number | null>(null);
  let undo = $state<{ id: number; message: string; onundo: () => Promise<void> } | undefined>();
  let undoSeq = 0;
  let showSnoozed = $state(false);
  let showSettled = $state(false);
  let settledShown = $state(SETTLED_PAGE);
  let liveText = $state('');
  let liveSteps = $state<ToolTraceStep[]>([]);
  let autoScroll = $state(true);

  const threadId = $derived(Number(router.params.get('thread')) || undefined);
  const contextParam = $derived(router.params.get('kontext'));
  /** On phones the conversation replaces the list (full screen, no dock); wide screens show both. */
  const conversationOpen = $derived(Boolean(threadId || contextParam || router.params.has('neu')));

  const byNewest = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');
  const pinned = $derived(threads.filter((t) => t.state === 'pinned'));
  const active = $derived(threads.filter((t) => t.state === 'active'));
  const snoozed = $derived(
    threads.filter((t) => t.state === 'snoozed').sort((a, b) => (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? '')),
  );
  const settled = $derived(threads.filter((t) => t.state === 'settled').sort((a, b) => byNewest(a.settledAt, b.settledAt)));
  const sending = $derived(creating || (thread !== undefined && sendingIds.includes(thread.id)));
  const pending = $derived(sending || Boolean(thread?.pending));
  const streamingId = $derived(thread?.pending ? thread.id : undefined);

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
      // Opening a chat that woke from its snooze acknowledges it.
      if (state.thread.woke) {
        thread = await api.updateThread(id, { snoozedUntil: null });
        void loadThreads();
      }
    } catch (e) {
      if (threadId === id) error = (e as Error).message;
    }
  }

  $effect(() => {
    api.agentStatus().then((s) => (status = s), () => (status = undefined));
  });

  $effect(() => {
    const id = threadId;
    autoScroll = true;
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

  // A new chat starts with the cursor in the composer.
  $effect(() => {
    if (router.params.has('neu') && composer) untrack(() => composer!.focus());
  });

  // While a turn is pending on the server (fresh send, retry, reload or returning
  // from another chat), subscribe to its live SSE stream for tokens and tool steps.
  $effect(() => {
    const id = streamingId;
    if (!id) {
      liveText = '';
      liveSteps = [];
      return;
    }
    liveText = '';
    liveSteps = [];
    const stop = api.streamThread(id, {
      onSnapshot(text, steps) {
        if (threadId !== id) return;
        liveText = text;
        liveSteps = steps;
      },
      onDelta(chunk) {
        if (threadId !== id) return;
        liveText += chunk;
      },
      onTool(step) {
        if (threadId !== id) return;
        const idx = liveSteps.findIndex((existing) => existing.id === step.id);
        if (idx >= 0) liveSteps = liveSteps.map((existing, i) => (i === idx ? step : existing));
        else liveSteps = [...liveSteps, step];
      },
      onDone(state) {
        stop();
        if (threadId === id) {
          thread = state.thread;
          messages = state.messages;
          liveText = '';
          liveSteps = [];
        }
        void loadThreads();
      },
      onDisconnect() {
        stop();
        if (threadId === id) void loadThread(id);
      },
    });
    return () => {
      stop();
    };
  });

  function onLogScroll() {
    if (!log) return;
    autoScroll = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }

  $effect(() => {
    void messages.length;
    void liveText;
    void liveSteps.length;
    void pending;
    if (autoScroll && log) log.scrollTop = log.scrollHeight;
  });

  async function send(event?: SubmitEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    creating = true;
    autoScroll = true;
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
      messages = [
        ...messages,
        { id: -1, threadId: target.id, role: 'user', content: preview, toolTrace: [], createdAt: new Date().toISOString() },
      ];
      draft = '';
      context = undefined;
      const state = await api.startSend(target.id, content, ctx);
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
    autoScroll = true;
    error = '';
    messages = messages.filter((message) => message.role !== 'error');
    let failure: Error | undefined;
    try {
      const state = await api.startRetry(id);
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

  function traceSummary(steps: ToolTraceStep[]): string {
    return steps.length === 1 ? '1 Abfrage' : `${steps.length} Abfragen`;
  }

  function openMenu(target: ChatThread, view: 'main' | 'snooze' = 'main') {
    openSwipeId = null;
    menuThread = target;
    menuInitialView = view;
    menuOpen = true;
  }

  function applyThreadUpdate(updated: ChatThread) {
    threads = threads.map((t) => (t.id === updated.id ? updated : t));
    if (thread?.id === updated.id) thread = updated;
  }

  function menuChanged(updated: ChatThread) {
    menuOpen = false;
    applyThreadUpdate(updated);
  }

  async function swipeSettle(item: ChatThread) {
    openSwipeId = null;
    error = '';
    const previous = { state: item.state, snoozedUntil: item.snoozedUntil };
    const reactivate = item.state === 'settled';
    try {
      const updated = await api.updateThread(item.id, { settled: !reactivate });
      applyThreadUpdate(updated);
      const token = ++undoSeq;
      undo = {
        id: token,
        message: reactivate ? 'Chat wieder aktiviert' : 'Chat erledigt',
        onundo: async () => {
          try {
            applyThreadUpdate(await api.updateThread(item.id, threadUndoPatch(previous)));
          } catch (e) {
            error = (e as Error).message;
          }
        },
      };
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function swipePatch(item: ChatThread, patch: Parameters<typeof api.updateThread>[1]) {
    openSwipeId = null;
    error = '';
    try {
      applyThreadUpdate(await api.updateThread(item.id, patch));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function menuDeleted(deleted: ChatThread) {
    menuOpen = false;
    threads = threads.filter((t) => t.id !== deleted.id);
    if (thread?.id === deleted.id) router.go('/chat', { replace: true });
  }

  function rowMeta(item: ChatThread): string {
    if (item.pending) return 'Agent antwortet …';
    if (item.state === 'snoozed') return `bis ${wakeLabel(item.snoozedUntil!)}`;
    if (item.state === 'settled') return `erledigt ${ago(item.settledAt)}`;
    return ago(item.updatedAt);
  }

  function open(event: MouseEvent, path: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.go(path);
  }

  // The list stays current when coming back from a conversation.
  $effect(() => {
    openSwipeId = null;
    if (conversationOpen) undo = undefined;
    void loadThreads();
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
  }
</script>

{#snippet row(item: ChatThread)}
  <SwipeRow
    testid="thread"
    open={openSwipeId === item.id}
    onopen={(isOpen) => (openSwipeId = isOpen ? item.id : openSwipeId === item.id ? null : openSwipeId)}
    right={{
      label: item.state === 'settled' ? 'Aktivieren' : 'Erledigt',
      icon: item.state === 'settled' ? 'undo' : 'check',
      onclick: () => void swipeSettle(item),
    }}
    left={[
      item.state === 'snoozed'
        ? {
            label: 'Aufwecken',
            icon: 'clock',
            tone: 'accent',
            onclick: () => void swipePatch(item, { snoozedUntil: null }),
          }
        : {
            label: 'Schlummern',
            icon: 'clock',
            tone: 'accent',
            onclick: () => openMenu(item, 'snooze'),
          },
      {
        label: item.state === 'pinned' ? 'Lösen' : 'Anheften',
        icon: 'pin',
        tone: 'neutral',
        pressed: item.state === 'pinned',
        filled: item.state === 'pinned',
        onclick: () => void swipePatch(item, { pinned: item.state !== 'pinned' }),
      },
    ]}
  >
    <div class="row" class:current={item.id === thread?.id}>
      <a href="/chat?thread={item.id}" onclick={(e) => open(e, `/chat?thread=${item.id}`)}>
        <span class="row-title">{item.title}</span>
        <span class="meta">
          {#if item.woke}<span class="badge">Wieder da</span>{/if}
          {rowMeta(item)}
        </span>
      </a>
      <button class="button quiet icon" type="button" onclick={() => openMenu(item)} aria-label="Aktionen: {item.title}">
        <Icon name="more" size={20} />
      </button>
    </div>
  </SwipeRow>
{/snippet}

{#snippet agentBadge()}
  {#if status}
    <span class="agent-status" data-testid="agent-status">
      <span class="dot" class:up={status.configured && status.reachable} class:off={!status.configured} aria-hidden="true"></span>
      {status.configured ? status.model : 'Kein Agent'}
      <span class="visually-hidden">{!status.configured ? '' : status.reachable ? ', erreichbar' : ', nicht erreichbar'}</span>
    </span>
  {/if}
{/snippet}

<div class="chat" class:open={conversationOpen}>
  <section class="list-pane" aria-labelledby="h-chat">
    <header class="list-head">
      <h1 id="h-chat">Chat</h1>
      {@render agentBadge()}
      <a class="button primary small" href="/chat?neu" onclick={(e) => open(e, '/chat?neu')}><Icon name="plus" size={16} />Neuer Chat</a>
    </header>

    {#if pinned.length}
      <h2 class="group">Angeheftet</h2>
      <ul class="threads">{#each pinned as item (item.id)}{@render row(item)}{/each}</ul>
    {/if}

    <h2 class="group">Aktiv</h2>
    {#if active.length}
      <ul class="threads">{#each active as item (item.id)}{@render row(item)}{/each}</ul>
    {:else}
      <p class="empty">Keine aktiven Chats.</p>
    {/if}

    {#if snoozed.length}
      <button class="shelf" type="button" aria-expanded={showSnoozed} onclick={() => (showSnoozed = !showSnoozed)}>
        <span class="chevron" aria-hidden="true"></span>Schlummernd <span class="count">{snoozed.length}</span>
      </button>
      {#if showSnoozed}
        <ul class="threads">{#each snoozed as item (item.id)}{@render row(item)}{/each}</ul>
      {/if}
    {/if}

    {#if settled.length}
      <button class="shelf" type="button" aria-expanded={showSettled} onclick={() => (showSettled = !showSettled)}>
        <span class="chevron" aria-hidden="true"></span>Erledigt <span class="count">{settled.length}</span>
      </button>
      {#if showSettled}
        <ul class="threads">{#each settled.slice(0, settledShown) as item (item.id)}{@render row(item)}{/each}</ul>
        {#if settled.length > settledShown}
          <button class="button quiet" type="button" onclick={() => (settledShown += SETTLED_PAGE)}>
            Mehr anzeigen ({settled.length - settledShown})
          </button>
        {/if}
      {/if}
    {/if}
  </section>

  <section class="conversation" aria-label="Unterhaltung">
    <header class="conv-head">
      <a class="button quiet icon back" href="/chat" onclick={(e) => open(e, '/chat')} aria-label="Zurück zur Chat-Liste">
        <Icon name="back" size={22} />
      </a>
      <div class="conv-title">
        <p class="title">{thread?.title ?? 'Neuer Chat'}</p>
        {@render agentBadge()}
      </div>
      {#if thread}
        <button class="button quiet icon" type="button" onclick={() => openMenu(thread!)} aria-label="Aktionen: {thread.title}">
          <Icon name="more" size={20} />
        </button>
      {/if}
    </header>

    <div class="log" bind:this={log} onscroll={onLogScroll}>
      {#each messages as message (message.id)}
        {#if message.role === 'user'}
          <div class="message user" data-testid="message-user"><p>{message.content}</p></div>
        {:else if message.role === 'assistant'}
          <div class="message assistant" data-testid="message-assistant">
            {#if message.toolTrace.length}
              <details class="tool-trace" data-testid="tool-trace">
                <summary>
                  <span class="chevron" aria-hidden="true"></span>
                  {traceSummary(message.toolTrace)}
                </summary>
                <ul class="tool-list">
                  {#each message.toolTrace as step (step.id)}
                    <li class="tool-step" class:error={step.status === 'error'} data-testid="tool-step">
                      <span class="step-dot" aria-hidden="true"></span>
                      <span>{step.label}</span>
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
            <!-- Assistant replies go only through the sanitizing renderer (no raw HTML, no images, http(s) links only). -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(message.content)}
          </div>
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
        <div class="live-turn" data-testid="live-turn">
          {#if liveSteps.length}
            <ul class="tool-list live" aria-label="Abfragen des Agenten" data-testid="live-tool-trace">
              {#each liveSteps as step (step.id)}
                <li class="tool-step" class:running={step.status === 'running'} class:error={step.status === 'error'} data-testid="tool-step">
                  <span class="step-dot" aria-hidden="true"></span>
                  <span>{step.label}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if liveText}
            <!-- Assistant replies go only through the sanitizing renderer (no raw HTML, no images, http(s) links only). -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="message assistant streaming" data-testid="message-assistant-streaming">{@html renderMarkdown(liveText)}</div>
          {:else}
            <p class="thinking" role="status">Agent antwortet …</p>
          {/if}
        </div>
      {/if}
    </div>

    {#if error}<p class="notice error" role="alert">{error}</p>{/if}

    <form class="composer" onsubmit={send}>
      {#if context}
        <div class="context" data-testid="chat-context">
          <div class="context-head">
            <span>Wird mitgesendet: {context.type === 'task' ? 'Aufgabe' : 'Feed-Eintrag'} «{context.title}»</span>
            <button
              class="button quiet icon"
              type="button"
              aria-label="Kontext entfernen"
              onclick={() => router.go(thread ? `/chat?thread=${thread.id}` : '/chat?neu', { replace: true })}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <pre>{context.text}</pre>
        </div>
      {/if}
      <div class="input-row">
        <label class="visually-hidden" for="chat-input">Nachricht</label>
        <textarea
          id="chat-input"
          class="input"
          bind:this={composer}
          bind:value={draft}
          onkeydown={keydown}
          maxlength="8000"
          rows="1"
          placeholder={context ? 'Was möchtest du dazu wissen?' : 'Nachricht an den Agenten'}
        ></textarea>
        <button class="button primary send" type="submit" disabled={pending || !draft.trim()} aria-label="Senden">
          <Icon name="send" size={20} />
        </button>
      </div>
    </form>
  </section>
</div>

<Sheet bind:open={menuOpen} title={menuThread?.title ?? 'Chat'}>
  {#if menuThread}
    <ThreadMenu thread={menuThread} initialView={menuInitialView} onchanged={menuChanged} ondeleted={menuDeleted} />
  {/if}
</Sheet>

{#if undo}
  <UndoToast id={undo.id} message={undo.message} onundo={undo.onundo} ondismiss={() => (undo = undefined)} />
{/if}

<style>
  .list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.85rem;
    margin: 0.5rem 0 1rem;
  }

  .list-head .small {
    margin-left: auto;
  }

  .agent-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--soft);
    font-size: var(--step--1);
  }

  /* Filled olive = reachable, ochre ring = down, grey ring = not configured (as on Heute). */
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--warn);
  }

  .dot.up {
    background: var(--accent);
    box-shadow: none;
  }

  .dot.off {
    box-shadow: inset 0 0 0 2px var(--soft);
  }

  .group {
    margin: 1.25rem 0 0.4rem;
    color: var(--soft);
    font-size: var(--step-0);
    font-weight: 650;
  }

  .threads {
    margin: 0;
    padding: 0.2rem 0;
    border-radius: var(--radius-l);
    background: var(--surface);
    list-style: none;
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    padding: 0 0.5rem;
  }

  .row.current a {
    color: var(--accent);
  }

  .row a {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.1rem;
    padding: 0.7rem 0.6rem;
    color: var(--ink);
    text-decoration: none;
  }

  .row-title {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    margin-right: 0.35rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 650;
  }

  .icon {
    justify-content: center;
    width: 2.75rem;
    padding: 0;
  }

  .shelf {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    margin: 1.25rem 0 0.4rem;
    padding: 0.25rem 0;
    border: 0;
    background: none;
    color: var(--soft);
    font-weight: 650;
    cursor: pointer;
  }

  .chevron {
    width: 0.5rem;
    height: 0.5rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(-45deg);
    transition: transform 120ms ease-out;
  }

  .shelf[aria-expanded='true'] .chevron {
    transform: rotate(45deg);
  }

  .count {
    font-weight: 450;
  }

  .conversation {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .conv-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--line);
  }

  .back {
    margin-left: -0.6rem;
  }

  .conv-title {
    flex: 1;
    min-width: 0;
  }

  .conv-title .title {
    margin: 0;
    overflow: hidden;
    font-size: 1.125rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log {
    flex: 1;
    display: grid;
    gap: 0.9rem;
    align-content: start;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 0.1rem;
  }

  .message {
    max-width: min(46rem, 92%);
    overflow-wrap: anywhere;
  }

  .message.user {
    justify-self: end;
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius-m) var(--radius-m) 4px var(--radius-m);
    background: var(--accent);
    color: var(--accent-on);
  }

  .message.user p {
    margin: 0;
    white-space: pre-wrap;
  }

  .message.assistant {
    justify-self: start;
    padding: 0.1rem 0 0.1rem 0.9rem;
    border-left: 3px solid var(--line);
  }

  .message.assistant.streaming {
    border-left-color: var(--accent);
  }

  .live-turn {
    display: grid;
    gap: 0.45rem;
    justify-items: start;
  }

  .tool-trace {
    margin: 0 0 0.45rem;
    color: var(--soft);
    font-size: var(--step--1);
  }

  .tool-trace summary {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.15rem 0;
    cursor: pointer;
    list-style: none;
    font-weight: 550;
  }

  .tool-trace summary::-webkit-details-marker {
    display: none;
  }

  .tool-trace summary .chevron {
    width: 0.4rem;
    height: 0.4rem;
  }

  .tool-trace[open] > summary .chevron {
    transform: rotate(45deg);
  }

  .tool-list {
    display: grid;
    gap: 0.25rem;
    margin: 0.35rem 0 0;
    padding: 0;
    list-style: none;
    color: var(--soft);
    font-size: var(--step--1);
  }

  .tool-list.live {
    margin: 0;
    padding: 0.35rem 0.7rem;
    border-radius: var(--radius-s);
    background: var(--surface);
  }

  .tool-step {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .step-dot {
    flex: none;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--accent);
  }

  .tool-step.running .step-dot {
    animation: step-pulse 1.1s ease-in-out infinite;
  }

  .tool-step.error {
    color: var(--warn);
  }

  .tool-step.error .step-dot {
    background: var(--warn);
  }

  @keyframes step-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .message.assistant :global(p) {
    margin: 0.4rem 0;
  }

  .message.assistant :global(pre) {
    overflow-x: auto;
    padding: 0.6rem;
    border-radius: var(--radius-s);
    background: var(--surface);
  }

  .message-error p {
    margin: 0 0 0.5rem;
  }

  .thinking {
    margin: 0;
    color: var(--soft);
  }

  .composer {
    display: grid;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--radius-l);
    background: var(--surface);
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .input-row textarea {
    flex: 1;
    min-height: 2.75rem;
    max-height: 9rem;
    border: 0;
    border-radius: var(--radius-m);
    resize: none;
    field-sizing: content;
  }

  .send {
    flex: none;
    justify-content: center;
    width: 2.75rem;
    padding: 0;
  }

  .context {
    border-left: 3px solid var(--accent);
    padding: 0.25rem 0 0 0.75rem;
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
    color: var(--soft);
    white-space: pre-wrap;
  }

  /* Phones: the list, or one conversation filling the screen with the composer at the bottom. */
  @media (max-width: 899px) {
    .chat:not(.open) .conversation,
    .chat.open .list-pane {
      display: none;
    }

    .chat.open .conversation {
      position: fixed;
      inset: 0;
      z-index: 6;
      padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 1rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
      background: var(--bg);
    }
  }

  /* Wide screens: list and conversation side by side; the dock stays. */
  @media (min-width: 900px) {
    .chat {
      display: grid;
      grid-template-columns: 20rem minmax(0, 1fr);
      gap: 2rem;
      align-items: start;
    }

    .list-pane {
      max-height: calc(100dvh - var(--dock-space) - 2rem);
      overflow-y: auto;
    }

    .conversation {
      position: sticky;
      top: 1.75rem;
      height: calc(100dvh - var(--dock-space) - 2.5rem);
    }

    .back {
      display: none;
    }
  }
</style>
