import { desktopCapturer, screen, systemPreferences } from 'electron';
import { TimeRing } from '../shared/ring-buffer.js';
import type { Frame, CaptureStats } from '../shared/channels.js';

/**
 * Frame capture, entirely in the main process.
 *
 * Deliberately NOT getDisplayMedia: a MediaStream makes Chromium treat the app as
 * screen-sharing, which puts a "Currently Sharing / Stop Sharing" window and a sharing
 * indicator on screen. desktopCapturer.getSources takes still thumbnails instead, so
 * there is no sharing session and no Chromium UI.
 *
 * macOS still shows its own screen-recording indicator in the menu bar whenever any app
 * reads the screen. That is an OS privacy feature, it cannot be suppressed, and we do not
 * want to: the user should always be able to see that something is watching.
 */
const ring = new TimeRing<Frame>(60_000, 240);
let timer: NodeJS.Timeout | null = null;
let intervalMs = 500;
let backedOffTo: number | null = null;
let tick: (() => void) | null = null;
function restart(): void { if (timer) clearInterval(timer); if (tick) timer = setInterval(tick, intervalMs); }
let grabs = 0, errors = 0, consecutiveErrors = 0, lastError: string | null = null;
let halted: string | null = null;
// Set by a timeout and never cleared for the life of the process: a request that never settles
// cannot be cancelled, so restarting would stack another behind it. Codex demonstrated the
// unresolved count rising from one to two through startCapture().
let timeoutLatch = false;
// Incremented on every stop. A grab that resolves after its generation ended is discarded,
// so stopping capture cannot be followed by a frame arriving from before it.
let generation = 0;
const grabMs: number[] = [];

/** Consecutive failures before the loop gives up. Never retry a blocked capture forever. */
const ERROR_CEILING = 5;

export type StartResult = { started: true } | { started: false; reason: string };

/**
 * Start capturing. Refuses to start unless Screen Recording is already granted.
 *
 * This refusal is not politeness, it is a hang guard. If the loop runs while a TCC
 * permission dialog is open, every grab blocks on a permission check that is itself
 * waiting on the user, the calls queue against WindowServer, and the machine locks up.
 * Learned the hard way on 2026-09-09.
 */
/**
 * Frames per second. Measured on an M-series Mac: one 1280px thumbnail grab has a median cost
 * of ~105ms, so 3 fps spends a third of every interval capturing. 2 fps halves that, and the
 * loop backs off further on its own if grabs turn out slower on the machine it lands on.
 */
export function startCapture(fps = 2, maxWidth = 1280, quality = 60): StartResult {
  if (timer) return { started: true };
  if (timeoutLatch) {
    return { started: false, reason: 'a capture request timed out earlier and can never be cancelled. '
      + 'Restarting would stack another request behind it. Restart the app.' };
  }
  const perm = screenPermission();
  if (perm !== 'granted') {
    halted = `screen recording permission is '${perm}' - not starting capture`;
    return { started: false, reason: halted };
  }
  halted = null; consecutiveErrors = 0;
  const disp = screen.getPrimaryDisplay();
  const width = maxWidth;
  const height = Math.round(maxWidth * disp.size.height / disp.size.width);
  let busy = false;
  intervalMs = Math.round(1000 / fps);
  tick = async () => {
    if (busy) return;                       // never stack grabs if one runs long
    busy = true;
    const myGeneration = generation;
    const t0 = Date.now();
    try {
      // A getSources call that never settles would leave `busy` true forever and the error
      // ceiling unreachable. Race a timeout - but a race only frees OUR flag, it does not
      // cancel the underlying request, so continuing would stack unresolved calls behind it.
      // Codex measured five piling up. One timeout therefore halts immediately.
      let timedOut = false;
      const sources = await Promise.race([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } }),
        new Promise<never>((_, rej) => setTimeout(() => { timedOut = true; rej(new Error('getSources timed out after 2s')); }, 2000)),
      ]).catch((e) => {
        if (timedOut) {
          timeoutLatch = true;
          halted = 'capture halted on the first timeout: a request that never settles cannot be '
                 + 'cancelled, so continuing would stack pending calls behind it';
          stopCapture();
        }
        throw e;
      });
      const img = sources[0]?.thumbnail;
      if (!img || img.isEmpty()) {
        errors++; consecutiveErrors++; lastError = 'empty thumbnail (permission revoked or display asleep)';
        if (consecutiveErrors >= ERROR_CEILING) { halted = `stopped after ${consecutiveErrors} empty thumbnails`; stopCapture(); }
        return;
      }
      const jpeg = img.toJPEG(quality);
      if (myGeneration !== generation) return;   // capture stopped while this grab was in flight
      ring.push({ ts: Date.now(), w: width, h: height, jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer, masked: false });
      grabs++; consecutiveErrors = 0; grabMs.push(Date.now() - t0);
      if (grabMs.length > 500) grabMs.shift();
      // Back off if capture is eating the interval. Better a slower replay than a machine
      // that feels sluggish while someone is trying to demonstrate it.
      if (grabMs.length >= 8 && grabMs.length % 8 === 0) {
        const sorted = [...grabMs].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (median > intervalMs * 0.35 && intervalMs < 2000) {
          intervalMs = Math.min(2000, Math.round(intervalMs * 1.5));
          backedOffTo = intervalMs;
          restart();
        }
      }
    } catch (e) {
      errors++; consecutiveErrors++; lastError = String(e);
      if (consecutiveErrors >= ERROR_CEILING) {
        halted = `stopped after ${consecutiveErrors} consecutive capture errors: ${lastError}`;
        stopCapture();
      }
    } finally { busy = false; }
  };
  timer = setInterval(tick, intervalMs);
  return { started: true };
}

export function stopCapture(): void { generation++; if (timer) clearInterval(timer); timer = null; tick = null; }
/** Drop every retained frame immediately. */
export function clearFrames(): void { ring.clear(); }

/** A frozen copy of the ring. Frames are never sent anywhere else. */
export function freeze(): Frame[] { return ring.snapshot(); }

export function captureStats(): CaptureStats & { grabs: number; errors: number; lastError: string | null; halted: string | null; intervalMs: number; backedOffTo: number | null; grabMsMedian: number | null } {
  const frames = ring.snapshot();
  const bytes = frames.reduce((n, f) => n + f.jpeg.byteLength, 0);
  const sorted = [...grabMs].sort((a, b) => a - b);
  return {
    frames: frames.length, bytes, fps: 3,
    oldestTs: frames[0]?.ts ?? 0, newestTs: frames[frames.length - 1]?.ts ?? 0,
    grabs, errors, lastError, halted, intervalMs, backedOffTo,
    grabMsMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}

/**
 * Deliberately attempt ONE capture to make macOS show the Screen Recording dialog.
 *
 * Necessary because startCapture() refuses to run without permission, so nothing would ever
 * trigger the prompt. This is a single call with a timeout, never a loop: the loop running
 * while the dialog is open is exactly what hung this machine on 2026-09-09.
 *
 * macOS requires a relaunch after granting, so the result is almost always still 'denied'.
 */
let permissionRequest: Promise<void> | null = null;

export async function requestScreenPermission(): Promise<{ status: string; prompted: boolean; note: string }> {
  const before = screenPermission();
  if (before === 'granted') return { status: before, prompted: false, note: 'Already granted.' };
  if (timeoutLatch) {
    return { status: before, prompted: false,
      note: 'A screen capture request timed out earlier and cannot be cancelled. Restart the app.' };
  }
  // Repeated prompting used to start a fresh unresolvable request each time. One shared
  // in-flight request, and the same permanent latch capture uses.
  if (permissionRequest) {
    await permissionRequest;
    return { status: screenPermission(), prompted: false, note: 'A request was already in flight.' };
  }
  try {
    permissionRequest = Promise.race([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 8, height: 8 } }).then(() => undefined),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    await permissionRequest;
  } catch (e) {
    if (String(e).includes('timeout')) timeoutLatch = true;
  } finally { permissionRequest = null; }
  return {
    status: screenPermission(),
    prompted: true,
    note: 'If a dialog appeared, allow it. If not, add this app by hand in System Settings > '
        + 'Privacy & Security > Screen Recording using the + button. Either way, QUIT AND '
        + 'RELAUNCH afterwards: macOS only applies the grant on the next launch.',
  };
}

export function screenPermission(): string {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}
