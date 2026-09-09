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

# The key goes on stdin, never in argv. Arguments are visible to anyone who can run ps while
# the command is alive, and they can be captured by process accounting.
security add-generic-password -a "${ACCOUNT}" -s "${SERVICE}" -U -w <<KEYEOF
${KEY}
KEYEOF
unset KEY

echo "Stored in the Keychain under service '${SERVICE}'."
echo
echo "Add this to ~/.zshrc, then open a new terminal:"
echo '  export OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s agent-starter-openai -w 2>/dev/null)"'
echo
echo "To check it loaded without printing it:"
echo '  [ -n "$OPENAI_API_KEY" ] && echo present || echo missing'
