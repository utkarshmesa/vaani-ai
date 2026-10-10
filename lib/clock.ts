/**
 * The app's single source of "now". Tests pin and advance it to exercise timers
 * (reminders, escalations, outcome requests) without waiting.
 */
let pinned: number | null = null;

export function now(): Date {
  return new Date(pinned ?? Date.now());
}

export function setNow(at: Date | string | null): void {
  pinned = at === null ? null : new Date(at).getTime();
}

export function advance(ms: number): void {
  pinned = (pinned ?? Date.now()) + ms;
}
