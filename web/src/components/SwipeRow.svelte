<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    ACTION_WIDTH,
    clampSwipeOffset,
    detectSwipeAxis,
    isNearViewportEdge,
    resolveSwipeEnd,
    rightThreshold,
    type SwipeAxis,
  } from '../lib/swipe';
  import Icon from './Icon.svelte';

  export interface SwipeRightAction {
    label: string;
    icon: string;
    onclick: () => void;
  }

  export interface SwipeLeftAction {
    label: string;
    icon: string;
    tone?: 'neutral' | 'accent' | 'danger';
    pressed?: boolean;
    filled?: boolean;
    onclick: () => void;
  }

  let {
    right,
    left = [],
    open = false,
    onopen,
    enabled = true,
    rowClass = '',
    testid,
    dataType,
    children,
  }: {
    right?: SwipeRightAction;
    left?: SwipeLeftAction[];
    open?: boolean;
    onopen?: (open: boolean) => void;
    enabled?: boolean;
    rowClass?: string;
    testid?: string;
    dataType?: string;
    children: Snippet;
  } = $props();

  let rowEl = $state<HTMLLIElement>();
  let offset = $state(0);
  let dragging = $state(false);
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let axis: SwipeAxis = 'none';
  let armed = $state(false);
  let suppressClick = false;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  let rowWidth = 360;

  const revealWidth = $derived(left.length * ACTION_WIDTH);
  const revealed = $derived(open || offset < -2);

  function clearSuppressClick() {
    suppressClick = false;
    clearTimeout(suppressTimer);
    suppressTimer = undefined;
  }

  $effect(() => {
    if (!enabled) clearSuppressClick();
    if (dragging) return;
    offset = open && enabled ? -revealWidth : 0;
  });

  $effect(() => () => clearTimeout(suppressTimer));

  // Close an open swipe tray when the user scrolls or taps outside this row.
  $effect(() => {
    if (!open) return;
    const onScroll = () => onopen?.(false);
    const onOutside = (event: PointerEvent) => {
      if (rowEl && !rowEl.contains(event.target as Node)) onopen?.(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('pointerdown', onOutside, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointerdown', onOutside);
    };
  });

  function onPointerDown(event: PointerEvent) {
    if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
    if ((event.target as HTMLElement | null)?.closest('[data-testid="swipe-actions"]')) return;
    if (!open && isNearViewportEdge(event.clientX, window.innerWidth)) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = open ? -revealWidth : 0;
    axis = 'none';
    armed = false;
    suppressClick = false;
    rowWidth = rowEl?.clientWidth || 360;
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === 'none') {
      axis = detectSwipeAxis(dx, dy);
      if (axis === 'vertical') {
        pointerId = null;
        return;
      }
      if (axis === 'horizontal') {
        dragging = true;
        suppressClick = true;
        if (!open) onopen?.(false);
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      } else {
        return;
      }
    }
    if (axis !== 'horizontal') return;
    const next = clampSwipeOffset(startOffset + dx, revealWidth, Boolean(right));
    offset = next;
    const nowArmed = Boolean(right) && next >= rightThreshold(rowWidth);
    if (nowArmed && !armed) navigator.vibrate?.(10);
    armed = nowArmed;
  }

  function finishGesture(event: PointerEvent, cancelled: boolean) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    const finalOffset = offset;
    const threshold = rightThreshold(rowWidth);
    armed = false;
    // Clear click suppression shortly after pointerup in case the browser emits no trailing click.
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(clearSuppressClick, 300);

    if (cancelled) {
      offset = open ? -revealWidth : 0;
      return;
    }

    const outcome = resolveSwipeEnd(finalOffset, startOffset, rowWidth, revealWidth, Boolean(right));
    if (outcome === 'right' && right && finalOffset >= threshold) {
      offset = 0;
      onopen?.(false);
      right.onclick();
    } else if (outcome === 'open') {
      offset = -revealWidth;
      onopen?.(true);
    } else {
      offset = 0;
      onopen?.(false);
    }
  }

  function onContentClickCapture(event: MouseEvent) {
    if (suppressClick) {
      clearSuppressClick();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      onopen?.(false);
    }
  }

  function triggerLeft(action: SwipeLeftAction) {
    clearSuppressClick();
    offset = 0;
    onopen?.(false);
    action.onclick();
  }
</script>

<li
  bind:this={rowEl}
  class="swipe-row {rowClass}"
  data-testid={testid}
  data-type={dataType}
  data-swipe-open={open ? 'true' : undefined}
>
  {#if right && offset > 0}
    <div class="swipe-right" class:armed aria-hidden="true">
      <Icon name={right.icon} size={20} />
      <span>{right.label}</span>
    </div>
  {/if}

  {#if left.length}
    <div
      class="swipe-left"
      data-testid="swipe-actions"
      aria-hidden={!revealed}
      inert={!revealed}
      style:visibility={revealed ? 'visible' : 'hidden'}
    >
      {#each left as action (action.label)}
        <button
          class="swipe-action tone-{action.tone ?? 'neutral'}"
          class:pressed={action.pressed}
          type="button"
          aria-pressed={action.pressed}
          onclick={() => triggerLeft(action)}
        >
          <Icon name={action.icon} size={19} filled={Boolean(action.filled)} />
          <span>{action.label}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Touch-only swipe container; all actions remain accessible via regular buttons and keyboard. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="swipe-content"
    class:dragging
    style:transform={offset !== 0 ? `translate3d(${offset}px, 0, 0)` : undefined}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={(e) => finishGesture(e, false)}
    onpointercancel={(e) => finishGesture(e, true)}
    onclickcapture={onContentClickCapture}
  >
    {@render children()}
  </div>
</li>

<style>
  .swipe-row {
    position: relative;
    overflow: hidden;
    border-top: 1px solid var(--line);
  }

  .swipe-row:first-child {
    border-top: 0;
  }

  .swipe-right {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding-left: 1.25rem;
    background: var(--accent-wash);
    color: var(--accent);
    font-weight: 650;
    pointer-events: none;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .swipe-right.armed {
    background: var(--accent);
    color: var(--accent-on);
  }

  .swipe-left {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: stretch;
  }

  .swipe-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 84px;
    padding: 0.4rem 0.25rem;
    border: 0;
    font-size: 0.8125rem;
    font-weight: 650;
    line-height: 1.15;
    cursor: pointer;
  }

  .tone-neutral {
    background: var(--surface-2);
    color: var(--ink);
  }

  .tone-neutral.pressed {
    background: var(--accent-wash);
    color: var(--accent);
  }

  .tone-accent {
    background: var(--accent);
    color: var(--accent-on);
  }

  .tone-danger {
    background: var(--warn);
    color: #fff;
  }

  @media (prefers-color-scheme: dark) {
    .tone-danger {
      color: var(--badge-ink);
    }
  }

  .swipe-content {
    position: relative;
    z-index: 1;
    background: var(--surface);
    touch-action: pan-y;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .swipe-content.dragging {
    transition: none;
    user-select: none;
  }
</style>
