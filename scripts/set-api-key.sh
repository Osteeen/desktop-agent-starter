#!/usr/bin/env bash
# Store the OpenAI API key in the macOS Keychain. The key is never written to
# disk in plaintext, never enters shell history, and never enters this repo.
#
#   bash scripts/set-api-key.sh
#
# Then add this line to ~/.zshrc so every new shell has it:
#   export OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s agent-starter-openai -w 2>/dev/null)"
set -euo pipefail

SERVICE="agent-starter-openai"
ACCOUNT="${USER}"

# Compile before reading the key. The helper uses Security.framework directly and explicitly
# consumes stdin, unlike security's terminal-only password prompt. No secret goes in argv.
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
mkdir -p "${SCRIPT_DIR}/../build"
HELPER_DIR="$(mktemp -d "${SCRIPT_DIR}/../build/keychain.XXXXXX")"
trap 'unset KEY; rm -rf -- "${HELPER_DIR}"' EXIT
/usr/bin/swiftc -parse-as-library -module-cache-path "${HELPER_DIR}/modules" \
  "${SCRIPT_DIR}/store-api-key.swift" -o "${HELPER_DIR}/store-api-key"

printf 'Paste your OpenAI API key (input is hidden), then press Return:\n> '
IFS= read -rs KEY
printf '\n'

if [ -z "${KEY}" ]; then
  echo "Nothing entered. Aborted." >&2
  exit 1
fi
case "${KEY}" in
  sk-*) : ;;
  *) echo "That does not look like an OpenAI key (expected it to start with 'sk-'). Aborted." >&2; exit 1 ;;
esac

# The helper stores and compares the readback with the original bytes in memory. Neither
# value is returned to the shell or printed, including on a same-length mismatch.
if ! printf '%s\n' "${KEY}" | "${HELPER_DIR}/store-api-key" "${ACCOUNT}" "${SERVICE}"; then
  echo "Could not store and verify the key in the Keychain." >&2
  unset KEY
  exit 1
fi
unset KEY

echo "Verified: stored and read back the exact key."

echo "Stored in the Keychain under service '${SERVICE}'."
echo
echo "Add this to ~/.zshrc, then open a new terminal:"
echo '  export OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s agent-starter-openai -w 2>/dev/null)"'
echo
echo "To check it loaded without printing it:"
echo '  [ -n "$OPENAI_API_KEY" ] && echo present || echo missing'
