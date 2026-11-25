import type { ChatThread, FeedItem, ThreadPatch } from './api';

/** Ignore touches starting near the screen edges so browser back-swipe stays intact. */
export const SWIPE_EDGE_GUARD = 24;
/** Pointer travel in px before locking either horizontal swipe or vertical scroll. */
export const SWIPE_SLOP = 10;
/** Width in px of each revealed left-swipe action button. */
export const ACTION_WIDTH = 84;

export type SwipeAxis = 'none' | 'horizontal' | 'vertical';
export type SwipeOutcome = 'right' | 'open' | 'closed';

export function isNearViewportEdge(clientX: number, viewportWidth: number): boolean {
  return clientX < SWIPE_EDGE_GUARD || clientX > viewportWidth - SWIPE_EDGE_GUARD;
}

/** Vertical scrolling wins whenever vertical travel is comparable to horizontal travel. */
export function detectSwipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.hypot(dx, dy) < SWIPE_SLOP) return 'none';
  if (Math.abs(dy) >= Math.abs(dx) * 0.85) return 'vertical';
  return 'horizontal';
}

export function rightThreshold(rowWidth: number): number {
  return Math.max(72, Math.min(110, Math.round(rowWidth * 0.3)));
}

export function clampSwipeOffset(raw: number, revealWidth: number, allowRight: boolean, maxRight = 150): number {
  if (raw > 0) {
    if (!allowRight) return 0;
    if (raw <= maxRight) return raw;
    return maxRight + (raw - maxRight) * 0.2;
  }
  if (raw < 0) {
    if (revealWidth <= 0) return 0;
    if (raw >= -revealWidth) return raw;
    return -revealWidth + (raw + revealWidth) * 0.25;
  }
  return 0;
}

export function resolveSwipeEnd(
  offset: number,
  startOffset: number,
  rowWidth: number,
  revealWidth: number,
  allowRight: boolean,
): SwipeOutcome {
  if (allowRight && offset >= rightThreshold(rowWidth)) return 'right';
  if (revealWidth > 0) {
    const threshold = startOffset < 0 ? -revealWidth * 0.65 : -revealWidth * 0.4;
    if (offset <= threshold) return 'open';
  }
  return 'closed';
}

/** Prefills the «Neue Aufgabe» sheet from a feed item within backend field limits. */
export function taskDraftFromFeedItem(item: Pick<FeedItem, 'title' | 'sourceTitle' | 'url'>): { title: string; note: string } {
  const title = item.title.trim().slice(0, 200);
  const noteParts = [`Quelle: ${item.sourceTitle}`];
  if (item.url) noteParts.push(item.url);
  return { title, note: noteParts.join('\n').slice(0, 4000) };
}

/** Builds the PATCH payload that restores a chat thread's state after right-swipe settle/reactivate. */
export function threadUndoPatch(previous: Pick<ChatThread, 'state' | 'snoozedUntil'>, now = Date.now()): ThreadPatch {
  if (previous.state === 'settled') return { settled: true };
  if (previous.state === 'pinned') return { pinned: true };
  if (previous.state === 'snoozed' && previous.snoozedUntil && Date.parse(previous.snoozedUntil) > now) {
    return { snoozedUntil: previous.snoozedUntil };
  }
  return { settled: false };
}
