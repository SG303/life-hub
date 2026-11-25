import { describe, expect, it } from 'vitest';
import {
  ACTION_WIDTH,
  clampSwipeOffset,
  detectSwipeAxis,
  isNearViewportEdge,
  resolveSwipeEnd,
  rightThreshold,
  taskDraftFromFeedItem,
  threadUndoPatch,
} from './swipe.ts';

describe('swipe gesture helpers', () => {
  it('guards outer viewport edges against browser back-swipe conflicts', () => {
    expect(isNearViewportEdge(10, 390)).toBe(true);
    expect(isNearViewportEdge(380, 390)).toBe(true);
    expect(isNearViewportEdge(24, 390)).toBe(false);
    expect(isNearViewportEdge(200, 390)).toBe(false);
  });

  it('prefers vertical scrolling over accidental horizontal drift', () => {
    expect(detectSwipeAxis(4, 4)).toBe('none');
    expect(detectSwipeAxis(12, 11)).toBe('vertical');
    expect(detectSwipeAxis(2, 18)).toBe('vertical');
    expect(detectSwipeAxis(20, 6)).toBe('horizontal');
    expect(detectSwipeAxis(-24, -10)).toBe('horizontal');
  });

  it('clamps and applies rubber-band resistance beyond bounds', () => {
    const reveal = ACTION_WIDTH * 2;
    expect(clampSwipeOffset(40, reveal, false)).toBe(0);
    expect(clampSwipeOffset(80, reveal, true)).toBe(80);
    expect(clampSwipeOffset(200, reveal, true, 150)).toBe(160);
    expect(clampSwipeOffset(-100, reveal, true)).toBe(-100);
    expect(clampSwipeOffset(-reveal - 40, reveal, true)).toBe(-reveal - 10);
  });

  it('resolves full right swipe, left reveal open, and snap-closed thresholds', () => {
    const reveal = ACTION_WIDTH * 2;
    expect(rightThreshold(360)).toBe(108);
    expect(resolveSwipeEnd(115, 0, 360, reveal, true)).toBe('right');
    expect(resolveSwipeEnd(60, 0, 360, reveal, true)).toBe('closed');
    expect(resolveSwipeEnd(-80, 0, 360, reveal, true)).toBe('open');
    expect(resolveSwipeEnd(-30, 0, 360, reveal, true)).toBe('closed');
    // Slightly nudging an already-open row to the right closes it.
    expect(resolveSwipeEnd(-90, -reveal, 360, reveal, true)).toBe('closed');
    expect(resolveSwipeEnd(-140, -reveal, 360, reveal, true)).toBe('open');
  });
});

describe('taskDraftFromFeedItem', () => {
  it('prefills title and note with source and link, respecting limits', () => {
    expect(
      taskDraftFromFeedItem({
        title: '  Neuer Artikel  ',
        sourceTitle: 'Testnachrichten',
        url: 'https://example.com/artikel',
      }),
    ).toEqual({
      title: 'Neuer Artikel',
      note: 'Quelle: Testnachrichten\nhttps://example.com/artikel',
    });

    expect(
      taskDraftFromFeedItem({
        title: 'x'.repeat(250),
        sourceTitle: 'Ohne Link',
        url: null,
      }),
    ).toEqual({
      title: 'x'.repeat(200),
      note: 'Quelle: Ohne Link',
    });
  });
});

describe('threadUndoPatch', () => {
  it('restores pinned, snoozed, active and settled states', () => {
    const now = Date.parse('2026-11-25T12:00:00.000Z');
    expect(threadUndoPatch({ state: 'active', snoozedUntil: null }, now)).toEqual({ settled: false });
    expect(threadUndoPatch({ state: 'pinned', snoozedUntil: null }, now)).toEqual({ pinned: true });
    expect(threadUndoPatch({ state: 'settled', snoozedUntil: null }, now)).toEqual({ settled: true });
    expect(threadUndoPatch({ state: 'snoozed', snoozedUntil: '2026-11-25T15:00:00.000Z' }, now)).toEqual({
      snoozedUntil: '2026-11-25T15:00:00.000Z',
    });
    // Expired snooze falls back to active.
    expect(threadUndoPatch({ state: 'snoozed', snoozedUntil: '2026-11-25T11:00:00.000Z' }, now)).toEqual({ settled: false });
  });
});
