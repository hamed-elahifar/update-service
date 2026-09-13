#!/usr/bin/env bash
# deploy.sh — generic deploy script
# Supports bun / npm / yarn / pnpm · PM2 process management
#
# VERSION: 1.4.0
#
# Usage:
#   ./bin/deploy.sh [<branch>] [--force] [--dry-run]
#   ./bin/deploy.sh --help
#
# Env overrides (all optional):
#   DEPLOY_BRANCH    Branch to deploy  (default: current git branch)
#   PM2_APP_NAME     PM2 app name      (default: every app in ecosystem.config.js)
#   DEPLOY_ECOSYSTEM pm2 ecosystem file (default: ecosystem.config.js)
#
# PM2 reload: every app is `pm2 delete`d then `pm2 start`ed fresh (not
# restarted/reloaded with --update-env) so each one boots reading this
# deploy's actual .env instead of a stale env snapshot baked in at some
# earlier `pm2 start`. This trades true zero-downtime reload for a
# guarantee that .env changes always take effect.

set -uo pipefail

# ── version ───────────────────────────────────────────────────────────────────
VERSION="2.0.0"

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
LOG_FILE="$LOG_DIR/deploy-$TIMESTAMP.log"
STAMP_FILE="$PROJECT_DIR/.deploy-stamp"

# ── colors (terminal only — log file always gets plain text) ──────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[0;32m'
  C_RED=$'\033[0;31m'
  C_CYAN=$'\033[0;36m'
  C_YELLOW=$'\033[0;33m'
else
  C_RESET='' C_BOLD='' C_GREEN='' C_RED='' C_CYAN='' C_YELLOW=''
fi

# ── logging ───────────────────────────────────────────────────────────────────
_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() {
  local msg="[$(_ts)] $*"
  printf '%s\n' "$msg" | tee -a "$LOG_FILE"
}

log_step() {
  printf '%s\n' "[$(_ts)] == $* ==" >> "$LOG_FILE"
  printf "${C_BOLD}${C_CYAN}[$(_ts)] == %s ==${C_RESET}\n" "$*"
}

log_ok() {
  printf '%s\n' "[$(_ts)] [OK] $*" >> "$LOG_FILE"
  printf "${C_GREEN}[$(_ts)] [OK] %s${C_RESET}\n" "$*"
}

log_skip() {
  printf '%s\n' "[$(_ts)] [SKIP] $*" >> "$LOG_FILE"
  printf "${C_YELLOW}[$(_ts)] [SKIP] %s${C_RESET}\n" "$*"
}

log_warn() {
  printf '%s\n' "[$(_ts)] [WARN] $*" >> "$LOG_FILE"
  printf "${C_YELLOW}[$(_ts)] [WARN] %s${C_RESET}\n" "$*"
}

log_err() {
  printf '%s\n' "[$(_ts)] [FAIL] $*" >> "$LOG_FILE"
  printf "${C_RED}[$(_ts)] [FAIL] %s${C_RESET}\n" "$*" >&2
}

# ── args ──────────────────────────────────────────────────────────────────────
DRY_RUN=false
FORCE=false
BRANCH_ARG=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<EOF
deploy.sh v${VERSION} -- generic zero-downtime deploy script

Usage:
  $(basename "$0") [<branch>] [--force] [--dry-run]
  $(basename "$0") --help

Options:
  <branch>     Branch to deploy (default: current branch or \$DEPLOY_BRANCH)
  --force      Skip stamp check; run install and build unconditionally
  --dry-run    Print commands without executing them
  -h, --help   Show this help

Env overrides:
  DEPLOY_BRANCH    Branch to deploy
  PM2_APP_NAME     Limit reload to one app (default: every app in ecosystem.config.js)
  DEPLOY_ECOSYSTEM pm2 ecosystem file (default: ecosystem.config.js)
  DEPLOY_BUILD_CMD Build command override (default: package.json "build" script)

Stamp file: .deploy-stamp (stores last deployed commit; delete to force full rebuild)
EOF
      exit 0
      ;;
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    -*) log_warn "Unknown flag: $arg" ;;
    *) [ -z "$BRANCH_ARG" ] && BRANCH_ARG="$arg" ;;
  esac
done

PM2_APP_NAME="${PM2_APP_NAME:-}"
# ponytail: lets a second checkout (e.g. a test env) reload its own pm2 apps
# instead of the ones in the shared ecosystem.config.js.
ECOSYSTEM="${DEPLOY_ECOSYSTEM:-ecosystem.config.js}"

# Current branch of $PROJECT_DIR, empty (not "HEAD") when detached --
# `rev-parse --abbrev-ref HEAD` would return the literal string "HEAD" here,
# which then resolves to origin/HEAD (the remote's default branch) below and
# silently deploys the wrong branch. symbolic-ref fails clean instead.
CURRENT_BRANCH="$(git -C "$PROJECT_DIR" symbolic-ref --short -q HEAD)"

if [ -z "$BRANCH_ARG" ] && [ -z "${DEPLOY_BRANCH:-}" ] && [ -z "$CURRENT_BRANCH" ]; then
  log_err "Repo at $PROJECT_DIR is in a detached HEAD state -- cannot infer branch to deploy."
  log_err "Pass it explicitly: $(basename "$0") <branch>   or set DEPLOY_BRANCH=<branch>"
  exit 1
fi

BRANCH="${BRANCH_ARG:-${DEPLOY_BRANCH:-$CURRENT_BRANCH}}"

# ── command runner ────────────────────────────────────────────────────────────
run_cmd() {
  log ">>> $*"
  if $DRY_RUN; then
    log_warn "[dry-run] skipped"
    return 0
  fi
  "$@" 2>&1 | sed $'s/\033\\[[0-9;]*[a-zA-Z]//g' | tee -a "$LOG_FILE"
  local exit_code="${PIPESTATUS[0]}"
  if [ "$exit_code" -ne 0 ]; then
    log_err "FAILED (exit $exit_code): $*"
    exit "$exit_code"
  fi
  log_ok "done"
}

# ── stamp helpers ─────────────────────────────────────────────────────────────
get_stamped_commit() {
  [ -f "$STAMP_FILE" ] && cat "$STAMP_FILE" || echo ""
}

save_stamp() {
  git -C "$PROJECT_DIR" rev-parse HEAD > "$STAMP_FILE"
}

# deps-related files changed between two commits?
deps_changed() {
  local from="$1" to="$2"
  [ -z "$from" ] && return 0
  ! git diff --quiet "$from" "$to" -- \
      package.json bun.lock bun.lockb pnpm-lock.yaml yarn.lock 2>/dev/null
}

# ── pm2 app detection (grep-based — no file execution, no dotenv side-effects)
# Returns one app name per line. With no PM2_APP_NAME override this returns
# *every* app defined in ecosystem.config.js -- see the "pm2 reload" step for
# why they all need to cycle on every deploy, not just the primary one.
detect_pm2_app_names() {
  local ecosystem="$PROJECT_DIR/$ECOSYSTEM"

  if [ ! -f "$ecosystem" ]; then
    echo "${PM2_APP_NAME:-app}"
    return 0
  fi

  # Extract name values from lines like:   name: 'zayche-backend',
  local configured_names
  configured_names="$(
    grep -E "^\s+name\s*:" "$ecosystem" \
      | sed "s/.*name[[:space:]]*:[[:space:]]*['\"]//; s/['\"].*//"
  )"

  if [ -z "$configured_names" ]; then
    echo "${PM2_APP_NAME:-app}"
    return 0
  fi

  if [ -n "${PM2_APP_NAME:-}" ]; then
    if grep -qxF "$PM2_APP_NAME" <<< "$configured_names"; then
      echo "$PM2_APP_NAME"
    else
      log_warn "PM2 app '$PM2_APP_NAME' not in $ECOSYSTEM -- deploying all configured apps instead"
      echo "$configured_names"
    fi
    return 0
  fi

  echo "$configured_names"
}

# ── package manager detection ─────────────────────────────────────────────────
select_install_cmd() {
  if { [ -f "$PROJECT_DIR/bun.lock" ] || [ -f "$PROJECT_DIR/bun.lockb" ]; } && command -v bun >/dev/null 2>&1; then
    echo "bun install"; return 0
  fi
  if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    echo "pnpm install"; return 0
  fi
  if [ -f "$PROJECT_DIR/yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
    echo "yarn install"; return 0
  fi
  if command -v npm >/dev/null 2>&1; then
    echo "npm install"; return 0
  fi
  return 1
}

select_build_cmd() {
  # ponytail: escape hatch for repos whose `build` script does more than build
  # (type-check, lint) and fails on pre-existing errors. Set per-app in
  # update-service config.json.
  if [ -n "${DEPLOY_BUILD_CMD:-}" ]; then echo "$DEPLOY_BUILD_CMD"; return 0; fi

  [ -f "$PROJECT_DIR/package.json" ] || return 1
  grep -q '"build"' "$PROJECT_DIR/package.json" || return 1

  if { [ -f "$PROJECT_DIR/bun.lock" ] || [ -f "$PROJECT_DIR/bun.lockb" ]; } && command -v bun >/dev/null 2>&1; then
    echo "bun run build"; return 0
  fi
  if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    echo "pnpm run build"; return 0
  fi
  if [ -f "$PROJECT_DIR/yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
    echo "yarn build"; return 0
  fi
  if command -v npm >/dev/null 2>&1; then
    echo "npm run build"; return 0
  fi
  return 1
}

# ── preflight ─────────────────────────────────────────────────────────────────
preflight() {
  local ok=true
  command -v git >/dev/null 2>&1  || { log_err "git not found in PATH";  ok=false; }
  command -v pm2 >/dev/null 2>&1  || { log_err "pm2 not found in PATH";  ok=false; }
  select_install_cmd >/dev/null   || { log_err "No package manager found (bun / pnpm / yarn / npm)"; ok=false; }
  $ok || exit 1
}

# ── main ──────────────────────────────────────────────────────────────────────
main() {
  local start_time="$SECONDS"

  log_step "deploy.sh v${VERSION}"
  log "Project  : $PROJECT_DIR"
  log "Branch   : $BRANCH"
  log "Log      : $LOG_FILE"
  $FORCE   && log_warn "--force: skipping stamp checks"
  $DRY_RUN && log_warn "DRY RUN -- no changes will be made"

  preflight

  cd "$PROJECT_DIR"

  # ── git sync ─────────────────────────────────────────────────────────────────
  log_step "git sync"
  local prev_commit
  prev_commit="$(get_stamped_commit)"

  run_cmd git reset --hard
  run_cmd git clean -fd
  run_cmd git fetch --all --prune
  run_cmd git checkout "$BRANCH"
  run_cmd git reset --hard "origin/$BRANCH"

  local new_commit
  new_commit="$(git rev-parse HEAD)"

  if [ "$new_commit" = "$prev_commit" ] && ! $FORCE; then
    log_ok "Already up-to-date ($new_commit) -- nothing to do"
    exit 0
  fi

  [ -n "$prev_commit" ] && log "Commit: ${prev_commit:0:8} -> ${new_commit:0:8}" \
                        || log "Commit: ${new_commit:0:8} (first deploy)"

  # ── install ──────────────────────────────────────────────────────────────────
  log_step "install"
  local install_cmd
  install_cmd="$(select_install_cmd)"

  if ! $FORCE && [ -n "$prev_commit" ] && ! deps_changed "$prev_commit" "$new_commit"; then
    log_skip "dependency files unchanged since last deploy"
  else
    run_cmd bash -c "cd '$PROJECT_DIR' && $install_cmd"
  fi

  # ── build ───────────────────────────────────────────────────────────────────
  log_step "build"
  local build_cmd
  if ! build_cmd="$(select_build_cmd)"; then
    log_warn "No 'build' script in package.json -- skipping"
  elif ! $FORCE && [ "$new_commit" = "$prev_commit" ]; then
    log_skip "no new commits since last deploy (${new_commit:0:8})"
  else
    run_cmd rm -rf "$PROJECT_DIR/dist"
    run_cmd mkdir -p "$PROJECT_DIR/dist"
    run_cmd bash -c "cd '$PROJECT_DIR' && $build_cmd"
    $DRY_RUN || save_stamp
  fi

  # ── pm2 reload ───────────────────────────────────────────────────────────────
  log_step "pm2 reload"
  local app_names
  app_names="$(detect_pm2_app_names)"

  if [ -f "$PROJECT_DIR/$ECOSYSTEM" ]; then
    # `pm2 restart/reload/startOrReload --update-env` only *merges* the
    # invoking shell's env into pm2's already-stored snapshot for the app --
    # it can never clear a key that was baked in at an earlier `pm2 start`
    # (e.g. from .env at that time) and isn't currently exported in this
    # shell. Our apps load .env themselves via dotenv at boot, and dotenv
    # never overrides an already-set process.env key, so a stale baked-in
    # value silently wins over a freshly edited .env forever. `pm2 delete` +
    # `pm2 start` is the only way to discard that stored snapshot and
    # guarantee the process boots with this deploy's actual .env contents.
    # This costs a brief restart gap instead of a true zero-downtime reload,
    # but a process silently running on stale config is worse.
    while IFS= read -r app_name; do
      [ -z "$app_name" ] && continue
      if pm2 jlist 2>/dev/null | grep -q "\"name\":\"$app_name\""; then
        run_cmd pm2 delete "$app_name"
      else
        log "pm2 app '$app_name' not currently running -- starting fresh"
      fi
      run_cmd pm2 start "$ECOSYSTEM" --only "$app_name"
    done <<< "$app_names"
  else
    run_cmd pm2 restart "$app_names" --update-env
  fi
  run_cmd pm2 save

  local elapsed=$(( SECONDS - start_time ))
  local app_names_display="${app_names//$'\n'/, }"
  printf '\n'
  log_ok "Deploy finished in ${elapsed}s  ·  apps: $app_names_display  ·  branch: $BRANCH"
  log    "Log file: $LOG_FILE"
}

main "$@"
