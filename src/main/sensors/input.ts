import { EventEmitter } from 'node:events';
import { noteInputEvent } from '../permissions.js';
/** Global input sensor. Records clicks and modifier shortcuts only - never plain characters. */
export interface ClickEvent { ts: number; x: number; y: number; button: number; phase: 'down' | 'up' }
export interface ComboEvent { ts: number; combo: string }
export const input = new EventEmitter();

/**
 * The only keys recorded, and only ever with Command held.
 *
 * Deliberately short. These are the commands that explain what happened to a file; anything
 * else is someone's work and none of our business.
 */
const COMMAND_KEYS = new Set([
  'Z',          // undo
  'Q', 'W',     // quit, close
  'S',          // save
  'C', 'X', 'V',// copy, cut, paste
  'N', 'O',     // new, open
  'Backspace', 'Delete',  // move to Trash
  'F',          // find
]);
let started = false;
export async function startInputSensor(): Promise<boolean> {
  if (started) return true;
  try {
    const { uIOhook, UiohookKey } = await import('uiohook-napi');
    const keyName = (code: number) => Object.entries(UiohookKey).find(([, v]) => v === code)?.[0] ?? `#${code}`;
    uIOhook.on('mousedown', (e) => { noteInputEvent(); input.emit('click', { ts: Date.now(), x: e.x, y: e.y, button: e.button, phase: 'down' } as ClickEvent); });
    uIOhook.on('mouseup', (e) => { noteInputEvent(); input.emit('click', { ts: Date.now(), x: e.x, y: e.y, button: e.button, phase: 'up' } as ClickEvent); });
    uIOhook.on('keydown', (e) => {
      noteInputEvent();
      // COMMAND KEY REQUIRED. Holding Command suppresses text entry on macOS, so Cmd+A,
      // Cmd+Opt+A and Cmd+Shift+A are all commands and none of them produce a character.
      // Control is NOT sufficient: Ctrl+Opt+1 inserts "1" on a US layout, which an earlier
      // "Command or Control" rule let through.
      if (!e.metaKey) return;

      const name = keyName(e.keycode);
      // Second gate: only the keys whose combinations explain what happened to a file.
      // An allowlist cannot be widened by a keyboard layout the way a rule can.
      if (!COMMAND_KEYS.has(name)) return;

      const mods = [
        'Cmd', e.ctrlKey && 'Ctrl', e.altKey && 'Opt', e.shiftKey && 'Shift',
      ].filter(Boolean) as string[];
      input.emit('combo', { ts: Date.now(), combo: [...mods, name].join('+') } as ComboEvent);
    });
    uIOhook.start(); started = true; return true;
  } catch (err) {
    input.emit('error', err); return false;
  }
}
/**
 * Stop the hook and wait for its background thread to quiesce.
 *
 * Must be awaited before app.exit(). uiohook posts events to JS from another thread; if the
 * Node environment tears down first, that call lands in a dying isolate and aborts the process
 * with "FATAL ERROR: uiohook_to_js_event napi_define_properties". Observed 2026-09-09.
 */
export async function stopInputSensor(): Promise<void> {
  if (!started) return;
  started = false;
  try {
    const { uIOhook } = await import('uiohook-napi');
    uIOhook.removeAllListeners();
    uIOhook.stop();
  } catch { /* never let shutdown throw */ }
  input.removeAllListeners();
  // One turn of the loop so any event already in flight is delivered to nothing.
  await new Promise((r) => setTimeout(r, 120));
}
