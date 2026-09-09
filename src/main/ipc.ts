import { ipcMain, type WebContents, type IpcMainInvokeEvent } from 'electron';
/** Hardened IPC: only registered windows may invoke; only the main frame; unknown channels never exist. */
const allowed = new Map<WebContents, string>();

/**
 * Register a window, pinned to the document it is supposed to be showing.
 *
 * Registration by WebContents alone survives navigation: a window sent to a data: or remote URL
 * kept its privileges and could still call main. Authorisation is now revoked the moment the
 * document changes, and navigation away from the expected file is refused outright.
 */
export function allowSender(wc: WebContents, expectedUrl: string): void {
  allowed.set(wc, expectedUrl);
  wc.once('destroyed', () => allowed.delete(wc));
  const sameDocument = (url: string) => url.split('#')[0] === expectedUrl.split('#')[0];
  wc.on('will-navigate', (e, url) => {
    if (!sameDocument(url)) { e.preventDefault(); console.warn('[ipc] blocked navigation to', url.slice(0, 80)); }
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('did-navigate', (_e, url) => {
    if (!sameDocument(url)) { allowed.delete(wc); console.warn('[ipc] revoked privileges after navigation to', url.slice(0, 80)); }
  });
}
export function handle<T extends unknown[]>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: T) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    const expected = allowed.get(event.sender);
    if (!expected) throw new Error(`ipc: sender not allowed on ${channel}`);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error(`ipc: subframe not allowed on ${channel}`);
    const actual = event.senderFrame?.url ?? '';
    if (actual.split('#')[0] !== expected.split('#')[0]) {
      allowed.delete(event.sender);
      throw new Error(`ipc: document is not the one registered for ${channel}`);
    }
    return fn(event, ...(args as T));
  });
}
