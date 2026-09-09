import { EventEmitter } from 'node:events';
import { noteInputEvent } from '../permissions.js';
/** Global input sensor. Records clicks and modifier shortcuts only - never plain characters. */
export interface ClickEvent { ts: number; x: number; y: number; button: number; phase: 'down' | 'up' }
export interface ComboEvent { ts: number; combo: string }
export const input = new EventEmitter();
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
      // A COMMAND requires Command or Control. Everything else composes text:
      //   Shift+A  -> "A"    Option+A -> "å"    Shift+Option+A -> "Å"
      // An earlier version required "any modifier", which recorded ordinary capitals and every
      // Option-composed character as if it were a shortcut. That contradicted the guarantee
      // that plain characters are never captured, so the rule is now explicit.
      if (!e.metaKey && !e.ctrlKey) return;

      const name = keyName(e.keycode);
      // A modifier pressed on its own carries no command.
      if (/^(Meta|Ctrl|Alt|Shift)(Right)?$/.test(name)) return;

      const mods = [
        e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.altKey && 'Opt', e.shiftKey && 'Shift',
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
