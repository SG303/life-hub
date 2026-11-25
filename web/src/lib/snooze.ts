/** Snooze presets for chats, in the device's local time (modelled on T3 Code's defaults). */

export interface SnoozePreset {
  label: string;
  until: Date;
}

function at(base: Date, dayOffset: number, hours: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, 0, 0, 0);
  return date;
}

export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const presets: SnoozePreset[] = [
    { label: 'In 1 Stunde', until: new Date(now.getTime() + 60 * 60 * 1000) },
    { label: 'In 3 Stunden', until: new Date(now.getTime() + 3 * 60 * 60 * 1000) },
  ];
  // «Heute 18:00» only while it is still more than half an hour away.
  const evening = at(now, 0, 18);
  if (evening.getTime() - now.getTime() > 30 * 60 * 1000) presets.push({ label: 'Heute, 18:00', until: evening });
  presets.push({ label: 'Morgen, 09:00', until: at(now, 1, 9) });
  // Next Monday after tomorrow (tomorrow already has its own preset).
  const toMonday = (8 - now.getDay()) % 7 || 7;
  if (toMonday > 1) presets.push({ label: 'Montag, 09:00', until: at(now, toMonday, 9) });
  return presets;
}

const time = (date: Date) => date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

/** «heute 18:00», «morgen 09:00», «Montag 09:00» or «3. Dez., 09:00». */
export function wakeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((at(date, 0, 0).getTime() - at(now, 0, 0).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return `heute ${time(date)}`;
  if (days === 1) return `morgen ${time(date)}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString('de-CH', { weekday: 'long' })} ${time(date)}`;
  return `${date.toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })}, ${time(date)}`;
}

/** Value for an `<input type="datetime-local">`, in local time. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
