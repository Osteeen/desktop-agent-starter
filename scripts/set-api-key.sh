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

# The key goes on stdin, never in argv: arguments are readable by anything that can run ps
# while the command is alive. `security -w` with no value prompts twice for confirmation, so
# the value is supplied twice. Sending it once produces "passwords don't match" and reprompts.
if ! printf '%s\n%s\n' "${KEY}" "${KEY}" | security add-generic-password -a "${ACCOUNT}" -s "${SERVICE}" -U -w >/dev/null 2>&1; then
  echo "Could not store the key in the Keychain." >&2
  unset KEY
  exit 1
fi
unset KEY

# Verify it round-trips before claiming success. Length only - the value is never printed.
STORED_LEN=$(security find-generic-password -a "${ACCOUNT}" -s "${SERVICE}" -w 2>/dev/null | tr -d '\n' | wc -c | tr -d ' ')
if [ "${STORED_LEN:-0}" -lt 20 ]; then
  echo "Stored, but reading it back gave ${STORED_LEN:-0} characters. Something is wrong." >&2
  exit 1
fi
echo "Verified: ${STORED_LEN} characters stored and read back."
unset KEY

echo "Stored in the Keychain under service '${SERVICE}'."
echo
echo "Add this to ~/.zshrc, then open a new terminal:"
echo '  export OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s agent-starter-openai -w 2>/dev/null)"'
echo
echo "To check it loaded without printing it:"
echo '  [ -n "$OPENAI_API_KEY" ] && echo present || echo missing'
