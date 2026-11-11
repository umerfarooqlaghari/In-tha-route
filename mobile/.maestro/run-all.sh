#!/bin/bash
# Runs every flow in order against the iOS simulator and prints a pass/fail summary.
# Usage: .maestro/run-all.sh [flow-file ...]   (from mobile/)
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$(ls -d ~/.jdk/jdk-17*/Contents/Home 2>/dev/null | head -1)}"
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
DEVICE="${DEVICE:-iPhone 18 Pro}"
UDID=$(xcrun simctl list devices booted | grep "$DEVICE (" | grep -oE '[0-9A-F-]{36}' | head -1)
# Location "Always" up front, so neither iOS nor the app's own "Always" note interrupts the flows.
xcrun simctl privacy "$UDID" grant location-always host.exp.Exponent >/dev/null 2>&1 || true
FLOWS=("$@"); [ ${#FLOWS[@]} -eq 0 ] && FLOWS=(flows/*.yaml)
mkdir -p results
pass=0; fail=0; failed=()
for f in "${FLOWS[@]}"; do
  name=$(basename "$f" .yaml)
  if maestro --device "$UDID" test "$f" --test-output-dir "results/$name" > "results/$name.log" 2>&1; then
    echo "PASS  $name"; pass=$((pass+1))
  else
    echo "FAIL  $name   (see .maestro/results/$name.log)"; fail=$((fail+1)); failed+=("$name")
  fi
done
echo "----"; echo "$pass passed, $fail failed"
[ $fail -eq 0 ]
