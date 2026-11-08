import { EventEmitter } from 'node:events';

/**
 * Live-updates: elke wijziging (via de site of via Claude/MCP) verhoogt de versie;
 * verbonden browsers krijgen dat direct door via Server-Sent Events.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(200);

export interface ChangeEvent {
  version: number;
  /** wie de wijziging deed (naam), of "Claude" */
  by?: string;
  what?: string;
}

let lastActor: { by?: string; what?: string } = {};

/** markeer wie de volgende wijziging doet (voor de melding bij de ander) */
export function setActor(by?: string, what?: string) {
  lastActor = { by, what };
}

export function notifyChange(version: number) {
  bus.emit('change', { version, ...lastActor } satisfies ChangeEvent);
  lastActor = {};
}

// ---------- wie is er online ----------
const online = new Map<string, { name: string; count: number }>();

export function presenceJoin(userId: string, name: string) {
  const e = online.get(userId) ?? { name, count: 0 };
  e.count += 1;
  online.set(userId, e);
  bus.emit('presence', presence());
}

export function presenceLeave(userId: string) {
  const e = online.get(userId);
  if (!e) return;
  e.count -= 1;
  if (e.count <= 0) online.delete(userId);
  bus.emit('presence', presence());
}

export function presence() {
  return [...online.entries()].map(([id, e]) => ({ id, name: e.name }));
}
