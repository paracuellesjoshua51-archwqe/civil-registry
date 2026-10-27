#!/usr/bin/env bash
# Prints groups of byte-identical files across the asset folders.
cd "$(dirname "$0")/.." || exit 1
find public src/assets -type f -print0 \
  | xargs -0 md5sum \
  | sort \
  | uniq -w32 -D --all-repeated=separate
