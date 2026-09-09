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
let grabs = 0, errors = 0, consecutiveErrors = 0, lastError: string | null = null;
let halted: string | null = null;
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
export function startCapture(fps = 3, maxWidth = 1280, quality = 60): StartResult {
  if (timer) return { started: true };
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
  timer = setInterval(async () => {
    if (busy) return;                       // never stack grabs if one runs long
    busy = true;
    const t0 = Date.now();
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const img = sources[0]?.thumbnail;
      if (!img || img.isEmpty()) {
        errors++; consecutiveErrors++; lastError = 'empty thumbnail (permission revoked or display asleep)';
        if (consecutiveErrors >= ERROR_CEILING) { halted = `stopped after ${consecutiveErrors} empty thumbnails`; stopCapture(); }
        return;
      }
      const jpeg = img.toJPEG(quality);
      ring.push({ ts: Date.now(), w: width, h: height, jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer, masked: false });
      grabs++; consecutiveErrors = 0; grabMs.push(Date.now() - t0);
      if (grabMs.length > 500) grabMs.shift();
    } catch (e) {
      errors++; consecutiveErrors++; lastError = String(e);
      if (consecutiveErrors >= ERROR_CEILING) {
        halted = `stopped after ${consecutiveErrors} consecutive capture errors: ${lastError}`;
        stopCapture();
      }
    } finally { busy = false; }
  }, Math.round(1000 / fps));
  return { started: true };
}

export function stopCapture(): void { if (timer) clearInterval(timer); timer = null; }

/** A frozen copy of the ring. Frames are never sent anywhere else. */
export function freeze(): Frame[] { return ring.snapshot(); }

export function captureStats(): CaptureStats & { grabs: number; errors: number; lastError: string | null; halted: string | null; grabMsMedian: number | null } {
  const frames = ring.snapshot();
  const bytes = frames.reduce((n, f) => n + f.jpeg.byteLength, 0);
  const sorted = [...grabMs].sort((a, b) => a - b);
  return {
    frames: frames.length, bytes, fps: 3,
    oldestTs: frames[0]?.ts ?? 0, newestTs: frames[frames.length - 1]?.ts ?? 0,
    grabs, errors, lastError, halted,
    grabMsMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}

export function screenPermission(): string {
  return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
}
