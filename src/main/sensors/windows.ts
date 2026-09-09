import { EventEmitter } from 'node:events';
/** Foreground-window sensor: polls the active window and emits on change. Titles are metadata; apply exclusion policy before retaining. */
export interface FrontWindow { ts: number; appName: string; bundleId: string | null; title: string; bounds: { x: number; y: number; width: number; height: number } }
export const front = new EventEmitter();
let timer: NodeJS.Timeout | null = null;
let last: string | null = null;
export async function startWindowSensor(intervalMs = 500): Promise<boolean> {
  if (timer) return true;
  try {
    const mod = await import('get-windows');
    timer = setInterval(async () => {
      try {
        const w = await mod.activeWindow();
        if (!w) return;
        const owner = w.owner as { name: string; bundleId?: string };
        const key = `${owner.name}|${w.title}`;
        if (key === last) return; last = key;
        const ev: FrontWindow = { ts: Date.now(), appName: owner.name, bundleId: owner.bundleId ?? null, title: w.title, bounds: w.bounds };
        front.emit('change', ev);
      } catch (err) { front.emit('error', err); }
    }, intervalMs);
    return true;
  } catch (err) { front.emit('error', err); return false; }
}
export function stopWindowSensor(): void { if (timer) clearInterval(timer); timer = null; }
