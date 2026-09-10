#!/usr/bin/env bash
# set-webhook.sh — point a repo's GitHub push webhook at an update-service app.
#
# Usage:
#   ./set-webhook.sh <app-name> [-r owner/repo] [-H host:port] [-s secret] [-n]
#   ./set-webhook.sh -l         [-r owner/repo]
#
#   -r  target repo         (default: the repo in the current directory)
#   -H  update-service host (default: $UPDATE_SERVICE_HOST or zayche.informa.ir:7777)
#   -s  webhook secret      (default: $WEBHOOK_SECRET or webhookSecret in ./config.json)
#   -n  dry run — print what would change, touch nothing
#   -l  list this repo's hooks and their last delivery status
#
# <app-name> must match an entry in the update-service config.json ON THE SERVER.
# One webhook URL runs every deployment nested under that app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${UPDATE_SERVICE_HOST:-zayche.informa.ir:7777}"
REPO=""
SECRET="${WEBHOOK_SECRET:-}"
DRY=false
LIST=false

APP=""

# Hand-rolled rather than getopts, which stops at the first non-option argument
# and would silently drop the flags in `set-webhook.sh myapp -n` — turning an
# intended dry run into a live webhook rewrite.
need() { [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    -r) need "$@"; REPO="$2"; shift 2 ;;
    -H) need "$@"; HOST="$2"; shift 2 ;;
    -s) need "$@"; SECRET="$2"; shift 2 ;;
    -n) DRY=true; shift ;;
    -l) LIST=true; shift ;;
    -h) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag $1 (try -h)" >&2; exit 2 ;;
    *)  [ -z "$APP" ] || { echo "unexpected argument: $1" >&2; exit 2; }
        APP="$1"; shift ;;
  esac
done

# gh expands the literal {owner}/{repo} itself, but only when run inside the
# target repo. Single quotes so the shell leaves the braces alone.
[ -n "$REPO" ] || REPO='{owner}/{repo}'

if $LIST; then
  gh api "repos/$REPO/hooks" --jq \
    '.[] | "\(.id)  active=\(.active)  events=\(.events|join(","))\n      url  = \(.config.url)\n      last = \(.last_response.status) \(.last_response.message // "")\n"'
  exit 0
fi

if [ -z "$APP" ]; then
  echo "usage: $(basename "$0") <app-name> [-r owner/repo] [-H host:port] [-s secret] [-n]" >&2
  exit 2
fi

# PATCH replaces the whole `config` object rather than merging into it, so the
# secret has to go out on every call. Drop it and the server starts answering
# 403 on signature checks instead of deploying.
if [ -z "$SECRET" ]; then
  SECRET="$(node -p "require('$SCRIPT_DIR/config.json').webhookSecret" 2>/dev/null || true)"
fi
if [ -z "$SECRET" ]; then
  echo "no secret: pass -s, set WEBHOOK_SECRET, or add webhookSecret to config.json" >&2
  exit 1
fi

URL="http://$HOST/$APP/"

# Only ever retarget a hook already pointing at this update-service host, so a
# repo that also has unrelated hooks (CI, chat) keeps them untouched.
EXISTING="$(gh api "repos/$REPO/hooks" \
  --jq ".[] | select(.config.url // \"\" | contains(\"$HOST\")) | .id" 2>/dev/null | head -1 || true)"

if $DRY; then
  # Resolve the placeholder for display — "{owner}/{repo}" confirms nothing, and
  # confirming the target is the entire point of a dry run.
  echo "repo   : $(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo "$REPO")"
  if [ -n "$EXISTING" ]; then echo "action : PATCH hook $EXISTING"; else echo "action : CREATE new hook"; fi
  echo "url    : $URL"
  echo "secret : ${#SECRET} chars"
  exit 0
fi

# Use GitHub's JSON content type for a standard webhook request body.
if [ -n "$EXISTING" ]; then
  gh api -X PATCH "repos/$REPO/hooks/$EXISTING" \
    -f "config[url]=$URL" \
    -f 'config[content_type]=json' \
    -f "config[secret]=$SECRET" \
    --jq '"updated hook \(.id) -> \(.config.url)"'
else
  gh api -X POST "repos/$REPO/hooks" \
    -f 'name=web' \
    -F 'active=true' \
    -f 'events[]=push' \
    -f "config[url]=$URL" \
    -f 'config[content_type]=json' \
    -f "config[secret]=$SECRET" \
    --jq '"created hook \(.id) -> \(.config.url)"'
fi

cat <<'NOTE'

note: a successful deploy still shows as a FAILED delivery in GitHub.
      update-service streams output for the whole deploy (~20s) while
      Hookshot times out near 10s. Check the server, not the hook UI:
        ssh root@HOST 'git -C /root/<app> log --oneline -1'
NOTE
