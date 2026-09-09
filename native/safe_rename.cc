// safe-rename: a single-syscall, no-overwrite rename for macOS.
// renameatx_np(..., RENAME_EXCL) fails with EEXIST if the destination exists,
// so nothing can ever be overwritten - the check and the move are one operation.
// It does NOT verify that the source is still the file you inspected; callers
// must stat before and verify (by inode) after. A mismatch is an incident.
#include <napi.h>
#include <cerrno>
#include <cstring>
#include <string>
#ifdef __APPLE__
#include <stdio.h>
#include <sys/fcntl.h>
#endif

static const char* CodeFor(int e) {
  switch (e) {
    case EEXIST: return "EEXIST";   case EXDEV: return "EXDEV";     case ENOTSUP: return "ENOTSUP";
    case ENOENT: return "ENOENT";   case EACCES: return "EACCES";   case EPERM: return "EPERM";
    case EISDIR: return "EISDIR";   case ENOTDIR: return "ENOTDIR"; case EINVAL: return "EINVAL";
    case ENOTEMPTY: return "ENOTEMPTY"; case EBUSY: return "EBUSY"; case EROFS: return "EROFS";
    default: return "EUNKNOWN";
  }
}

static Napi::Value RenameExcl(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "renameExcl(src, dst): two strings required").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string src = info[0].As<Napi::String>().Utf8Value();
  std::string dst = info[1].As<Napi::String>().Utf8Value();
  Napi::Object out = Napi::Object::New(env);

  // A JavaScript string may contain NUL, a C string may not. Passing one through c_str()
  // silently truncates: the caller believes it asked for "safe\0HIDDEN" and the kernel is
  // asked for "safe". The operation then reports success for a path nobody requested.
  // Refuse instead, so what the caller asked for and what happened cannot diverge.
  if (src.find('\0') != std::string::npos || dst.find('\0') != std::string::npos) {
    out.Set("ok", Napi::Boolean::New(env, false));
    out.Set("code", Napi::String::New(env, "EINVAL"));
    out.Set("errno", Napi::Number::New(env, EINVAL));
    out.Set("message", Napi::String::New(env,
      "path contains a NUL byte; refusing rather than silently truncating it"));
    return out;
  }
  if (src.empty() || dst.empty()) {
    out.Set("ok", Napi::Boolean::New(env, false));
    out.Set("code", Napi::String::New(env, "EINVAL"));
    out.Set("errno", Napi::Number::New(env, EINVAL));
    out.Set("message", Napi::String::New(env, "path is empty"));
    return out;
  }
#ifdef __APPLE__
  errno = 0;
  int rc = renameatx_np(AT_FDCWD, src.c_str(), AT_FDCWD, dst.c_str(), RENAME_EXCL);
  if (rc == 0) { out.Set("ok", Napi::Boolean::New(env, true)); return out; }
  int e = errno;
  out.Set("ok", Napi::Boolean::New(env, false));
  out.Set("code", Napi::String::New(env, CodeFor(e)));
  out.Set("errno", Napi::Number::New(env, e));
  out.Set("message", Napi::String::New(env, std::strerror(e)));
  return out;
#else
  out.Set("ok", Napi::Boolean::New(env, false));
  out.Set("code", Napi::String::New(env, "ENOTSUP"));
  out.Set("errno", Napi::Number::New(env, 0));
  out.Set("message", Napi::String::New(env, "renameatx_np is macOS-only"));
  return out;
#endif
}

static Napi::Value Supported(const Napi::CallbackInfo& info) {
#ifdef __APPLE__
  return Napi::Boolean::New(info.Env(), true);
#else
  return Napi::Boolean::New(info.Env(), false);
#endif
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("renameExcl", Napi::Function::New(env, RenameExcl));
  exports.Set("supported", Napi::Function::New(env, Supported));
  return exports;
}
NODE_API_MODULE(safe_rename, Init)
