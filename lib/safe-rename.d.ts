export type RenameResult = { ok: true } | { ok: false; code: string; errno: number; message: string };
export function renameExcl(src: string, dst: string): RenameResult;
export function supported(): boolean;
