#!/usr/bin/env bash
# Resolve the installed skill directory for dev-browser.
# Outputs the resolved path to stdout. Exits 1 if not found.
SKILL_NAME="dev-browser"
SKILL_DIR=""
for base in \
  "${CODEX_HOME:-$HOME/.codex}/skills" \
  "$HOME/.agents/skills" \
  "$HOME/.claude/skills" \
  "$HOME/.codex/skills" \
  "$HOME/.config/agents/skills"
do
  if [ -d "$base/$SKILL_NAME" ]; then
    SKILL_DIR="$base/$SKILL_NAME"
    break
  fi
done

if [ -z "$SKILL_DIR" ]; then
  SEARCH_DIR=$(pwd -P)
  while :; do
    for base in \
      "$SEARCH_DIR/skills" \
      "$SEARCH_DIR/.agents/skills" \
      "$SEARCH_DIR/.claude/skills" \
      "$SEARCH_DIR/.codex/skills" \
      "$SEARCH_DIR/.config/agents/skills"
    do
      if [ -d "$base/$SKILL_NAME" ]; then
        SKILL_DIR="$base/$SKILL_NAME"
        break 2
      fi
    done
    [ "$SEARCH_DIR" = "/" ] && break
    SEARCH_DIR=$(dirname "$SEARCH_DIR")
  done
fi

[ -n "$SKILL_DIR" ] || { echo "Skill not found: $SKILL_NAME" >&2; exit 1; }

echo "$SKILL_DIR"
