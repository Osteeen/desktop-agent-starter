import { ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron';
/** Hardened IPC: only registered windows may invoke; only the main frame; unknown channels never exist. */
const allowed = new Set<WebContents>();
export function allowSender(wc: WebContents): void { allowed.add(wc); wc.once('destroyed', () => allowed.delete(wc)); }
export function handle<T extends unknown[]>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: T) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!allowed.has(event.sender)) throw new Error(`ipc: sender not allowed on ${channel}`);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error(`ipc: subframe not allowed on ${channel}`);
    return fn(event, ...(args as T));
  });
}
