import { describe, expect, it } from 'vitest';
import { compactLabel } from './format.ts';

const today = '2026-11-26';

describe('compactLabel', () => {
  it('shows the due date for overdue and upcoming tasks', () => {
    expect(compactLabel('2026-11-24', 'Haushalt', today)).toBe('Seit 2 Tagen');
    expect(compactLabel('2026-11-27', 'Haushalt', today)).toBe('Morgen');
  });

  it('shows the list instead of «Heute» for tasks due today', () => {
    expect(compactLabel(today, 'Admin', today)).toBe('Admin');
  });

  it('shows the list or nothing for tasks without a due date', () => {
    expect(compactLabel(null, 'Haushalt', today)).toBe('Haushalt');
    expect(compactLabel(null, null, today)).toBe('');
    expect(compactLabel(today, null, today)).toBe('');
  });
});
