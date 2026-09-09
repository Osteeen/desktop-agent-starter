import { EventEmitter } from 'node:events';
/** Foreground-window sensor: polls the active window and emits on change. Titles are metadata; apply exclusion policy before retaining. */
export interface FrontWindow { ts: number; appName: string; bundleId: string | null; title: string; bounds: { x: number; y: number; width: number; height: number } }
export const front = new EventEmitter();
let timer: NodeJS.Timeout | null = null;
let last: string | null = null;
let busy = false;
let consecutiveErrors = 0;
let halted: string | null = null;
const ERROR_CEILING = 5;
const CALL_TIMEOUT_MS = 3000;
export async function startWindowSensor(intervalMs = 500): Promise<boolean> {
  if (timer) return true;
  try {
    const mod = await import('get-windows');
    timer = setInterval(async () => {
      // The macOS adapter launches a subprocess per call. Without this guard a stalled call
      // let the next interval start another, and they accumulated without limit.
      if (busy) return;
      busy = true;
      try {
        const w = await Promise.race([
          mod.activeWindow(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('activeWindow timed out')), CALL_TIMEOUT_MS)),
        ]);
        consecutiveErrors = 0;
        if (!w) return;
        const owner = w.owner as { name: string; bundleId?: string };
        const key = `${owner.name}|${w.title}`;
        if (key === last) return; last = key;
        const ev: FrontWindow = { ts: Date.now(), appName: owner.name, bundleId: owner.bundleId ?? null, title: w.title, bounds: w.bounds };
        front.emit('change', ev);
      } catch (err) {
        consecutiveErrors++;
        front.emit('error', err);
        if (consecutiveErrors >= ERROR_CEILING) {
          halted = `window sensor stopped after ${consecutiveErrors} consecutive failures: ${String(err).slice(0, 120)}`;
          stopWindowSensor();
        }
      } finally { busy = false; }
    }, intervalMs);
    return true;
  } catch (err) { front.emit('error', err); return false; }
}
export function stopWindowSensor(): void { if (timer) clearInterval(timer); timer = null; }
export function windowSensorHalted(): string | null { return halted; }
