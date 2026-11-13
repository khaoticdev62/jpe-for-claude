#!/usr/bin/env bash
set -euo pipefail
mkdir -p src
cat > package.json <<'JSON'
{ "name": "no-tests", "private": true, "type": "module" }
JSON
cat > src/discount.mjs <<'JS'
export function discount(amount, percent) {
  return amount - amount * (percent / 100);
}
JS
