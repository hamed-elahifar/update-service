#!/usr/bin/env bash
# Argument-parsing check for set-webhook.sh. No network: `gh` is stubbed on PATH
# so every case ends in the dry-run branch and nothing is ever written.
#
#   ./test-set-webhook.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT

# Pretends the repo already has one hook (id 111) on zayche.informa.ir:7777.
cat > "$STUB/gh" <<'STUBEOF'
#!/usr/bin/env bash
for a in "$@"; do case "$a" in *zayche.informa.ir:7777*) echo 111; exit 0 ;; esac; done
exit 0
STUBEOF
chmod +x "$STUB/gh"
export PATH="$STUB:$PATH"
export WEBHOOK_SECRET="test-secret"

fails=0
check() { # check <label> <expected-substring> <args...>
  local label="$1" want="$2"; shift 2
  local got
  got="$(bash "$DIR/set-webhook.sh" "$@" 2>&1)" || true
  if [[ "$got" == *"$want"* ]]; then
    echo "  ok   $label"
  else
    echo "  FAIL $label"
    echo "       want substring: $want"
    echo "       got: ${got//$'\n'/ | }"
    fails=$((fails + 1))
  fi
}

echo "set-webhook.sh argument parsing"

# The regression: getopts stopped at the positional arg, so -n was dropped and
# the "dry run" performed a live PATCH.
check "flag after positional is honoured" "action :" myapp -n
check "flag before positional is honoured" "action :" -n myapp
check "-n reaches dry run, never writes"   "url    : http://zayche.informa.ir:7777/myapp/" myapp -n
check "-H after positional applies"        "url    : http://other:1234/myapp/" myapp -n -H other:1234
check "-H before positional applies"       "url    : http://other:1234/myapp/" -H other:1234 -n myapp
check "known host means PATCH not CREATE"  "action : PATCH hook 111" myapp -n
check "unknown host means CREATE"          "action : CREATE new hook" myapp -n -H other:1234
check "-s overrides the env secret"        "secret : 11 chars" myapp -n -s 12345678901
check "missing app name is rejected"       "usage:" -n
check "unknown flag is rejected"           "unknown flag -z" myapp -z
check "flag missing its value is rejected" "-H needs a value" myapp -H

if [ "$fails" -eq 0 ]; then
  echo "all passed"
else
  echo "$fails failed"
  exit 1
fi
