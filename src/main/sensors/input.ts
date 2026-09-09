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
      const mods = [e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.altKey && 'Opt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
      if (mods.length === 0) return;                      // plain typing is dropped before anything is stored
      if (['Meta', 'Ctrl', 'Alt', 'Shift', 'MetaRight', 'CtrlRight', 'AltRight', 'ShiftRight'].includes(keyName(e.keycode))) return;
      input.emit('combo', { ts: Date.now(), combo: [...mods, keyName(e.keycode)].join('+') } as ComboEvent);
    });
    uIOhook.start(); started = true; return true;
  } catch (err) {
    input.emit('error', err); return false;
  }
}
export function stopInputSensor(): void { if (!started) return; import('uiohook-napi').then(({ uIOhook }) => uIOhook.stop()).catch(() => {}); started = false; }
