# Security notes

## What this starter does that needs care

It reads the screen, observes global input, watches folders, and moves files. Each is a real
capability, so the boundaries are stated here rather than left implicit.

**Screen capture.** Frames live in an in-memory ring, evicted by time, and are never written to
disk by this code. macOS shows its own recording indicator whenever any app reads the screen; that
indicator is not suppressed and should not be.

**Input.** Only mouse events and modifier shortcuts are recorded. Key events without a real
modifier are discarded before anything is stored, so ordinary typing, capital letters included, is
never captured. Shift alone is not treated as a modifier, because Shift+A is a capital A.

**File moves.** The only operation that moves a file is `renameatx_np` with `RENAME_EXCL`: one
syscall that fails if the destination exists. It cannot overwrite. It does **not** verify that the
source is still the file you inspected, so callers must `stat` before and verify by inode after,
and treat a mismatch as an incident rather than a success.

## Renderer isolation

Every window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`.
Renderers reach main only through a named preload bridge; every handler validates that the sender
is a registered window and that the call came from the main frame rather than a subframe. Each
page carries a Content Security Policy with `default-src 'none'`.

Inline scripts are permitted (`script-src 'unsafe-inline'`) because the pages are self-contained
and load nothing external. A product built on this should tighten that.

## Findings from the audit of 2026-09-09

**Fixed: NUL truncation in the rename addon.** A JavaScript string may contain NUL; a C string may
not. Passing one through `c_str()` truncated silently, so a caller asking to create `safe\0HIDDEN`
got a file called `safe` and a report of success. What the caller asked for and what happened could
diverge without any error. Paths containing NUL, and empty paths, are now refused with `EINVAL`.
Regression tests cover both.

**Reviewed, no change needed.** Overlong names, `..` segments and empty strings are all rejected by
the kernel with ordinary errors and nothing is created. The addon holds no raw pointer beyond the
lifetime of its owning `std::string`. `permissions:open` is allowlisted to three known panes and
cannot be induced to open an arbitrary URL.

**Known, accepted.** `npm audit` reports six advisories, all in the build toolchain reached
transitively through `get-windows` (`node-gyp`, `tar`, `cacache`, `node-pre-gyp`). None of them are
loaded at runtime and none are included in a packaged build. Rebuild the dependency tree before
shipping anything that does execute them.

## Reporting

This is a starter, not a product. Open an issue.
