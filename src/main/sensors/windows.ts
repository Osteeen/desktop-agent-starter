import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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
    // Load the macOS implementation DIRECTLY, not the package index.
    //
    // index.js statically imports lib/macos.js, lib/linux.js AND lib/windows.js, and
    // lib/windows.js imports @mapbox/node-pre-gyp, which drags in node-gyp, cacache,
    // make-fetch-happen and a vulnerable tar. On a macOS-only app that whole chain loads for
    // nothing: lib/macos.js only runs the prebuilt `main` binary through execFile.
    //
    // The package's `exports` map has no subpath entries, so the file is resolved through its
    // package.json and imported by URL. That keeps the six advisories off the runtime graph and
    // lets the packager drop them from the bundle.
    // Only "." is in the exports map, so resolve the entry point and walk to the leaf beside it.
    const entry = createRequire(__filename).resolve('get-windows');
    const macosUrl = pathToFileURL(path.join(path.dirname(entry), 'lib', 'macos.js')).href;
    const mod = (await import(macosUrl)) as { activeWindow: (o?: unknown) => Promise<unknown> };
    timer = setInterval(async () => {
      // The macOS adapter launches a subprocess per call. Without this guard a stalled call
      // let the next interval start another, and they accumulated without limit.
      if (busy) return;
      busy = true;
      try {
        const w = await Promise.race([
          mod.activeWindow() as Promise<{ owner: { name: string; bundleId?: string }; title: string; bounds: FrontWindow['bounds'] } | undefined>,
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
        // A timed-out call is still running: the race frees our guard but cannot cancel the
        // subprocess. Continuing would stack another behind it, which is how five accumulated.
        if (String(err).includes('timed out')) {
          halted = 'window sensor halted on the first timeout: the underlying call cannot be cancelled, so continuing would stack subprocesses';
          stopWindowSensor();
          return;
        }
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
