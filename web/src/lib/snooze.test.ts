import { describe, expect, it } from 'vitest';
import { localInputValue, snoozePresets, wakeLabel } from './snooze.ts';

// Local times, so the tests do not depend on the machine's time zone.
const wednesday = (hours: number, minutes = 0) => new Date(2026, 10, 25, hours, minutes);

describe('snoozePresets', () => {
  it('offers hours, this evening, tomorrow morning and next Monday', () => {
    const presets = snoozePresets(wednesday(10));
    expect(presets.map((p) => p.label)).toEqual(['In 1 Stunde', 'In 3 Stunden', 'Heute, 18:00', 'Morgen, 09:00', 'Montag, 09:00']);
    expect(presets[2]!.until).toEqual(wednesday(18));
    expect(presets[3]!.until).toEqual(new Date(2026, 10, 26, 9));
    expect(presets[4]!.until).toEqual(new Date(2026, 10, 30, 9));
  });

  it('drops «Heute» late in the day and «Montag» on Sundays (tomorrow covers it)', () => {
    expect(snoozePresets(wednesday(17, 40)).map((p) => p.label)).not.toContain('Heute, 18:00');
    expect(snoozePresets(new Date(2026, 10, 29, 10)).map((p) => p.label)).not.toContain('Montag, 09:00');
    // On a Monday, «Montag» means next week.
    expect(snoozePresets(new Date(2026, 10, 30, 10)).at(-1)!.until).toEqual(new Date(2026, 11, 7, 9));
  });
});

describe('wakeLabel', () => {
  it('names the day relative to now', () => {
    const now = wednesday(10);
    expect(wakeLabel(wednesday(18).toISOString(), now)).toBe('heute 18:00');
    expect(wakeLabel(new Date(2026, 10, 26, 9).toISOString(), now)).toBe('morgen 09:00');
    expect(wakeLabel(new Date(2026, 10, 30, 9).toISOString(), now)).toBe('Montag 09:00');
    expect(wakeLabel(new Date(2026, 11, 3, 9).toISOString(), now)).toMatch(/^3\. Dez\.?, 09:00$/);
  });

  it('formats datetime-local values', () => {
    expect(localInputValue(wednesday(7, 5))).toBe('2026-11-25T07:05');
  });
});
