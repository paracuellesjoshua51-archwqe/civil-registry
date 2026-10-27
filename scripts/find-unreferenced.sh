#!/usr/bin/env bash
# Lists src files whose base name is not mentioned in any other src import.
# Heuristic: dynamic imports and string-built paths can show as false positives.
cd "$(dirname "$0")/../src" || exit 1

find . -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.css' \) | sort | while read -r f; do
  name=$(basename "$f"); name="${name%.*}"
  case "$name" in main|App) continue ;; esac
  refs=$(grep -rlE "[\"'][^\"']*\b${name}(\.[A-Za-z]+)?[\"']" \
           --include='*.js' --include='*.jsx' --include='*.css' . \
         | grep -v -F "$f" | wc -l)
  [ "$refs" -eq 0 ] && echo "UNREFERENCED: $f"
done
