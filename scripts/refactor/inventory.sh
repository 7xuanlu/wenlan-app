#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/docs/superpowers/refactor/wenlan-app-inventory"
SG=(npx -y -p @ast-grep/cli sg)

mkdir -p "$OUT"

"${SG[@]}" outline "$ROOT/src/lib/tauri.ts" > "$OUT/tauri-ts-outline.txt"
"${SG[@]}" outline "$ROOT/app/src/api.rs" > "$OUT/api-rs-outline.txt"
"${SG[@]}" outline "$ROOT/app/src/search.rs" > "$OUT/search-rs-outline.txt"
"${SG[@]}" run -p 'invoke($CMD, $$$ARGS)' -l ts "$ROOT/src" > "$OUT/frontend-invokes.txt"
"${SG[@]}" run -p 'pub struct $NAME { $$$FIELDS }' -l rs "$ROOT/app/src" > "$OUT/rust-structs.txt"

{
  echo "# Wenlan App Structural Inventory"
  echo
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- branch: $(git branch --show-current)"
  echo "- head: $(git rev-parse --short HEAD)"
  echo
  echo "## Counts"
  printf -- "- frontend invoke calls: "
  rg -n "invoke\\(" "$ROOT/src/lib/tauri.ts" | wc -l | tr -d ' '
  printf -- "- registered Tauri commands: "
  rg -n "search::" "$ROOT/app/src/lib.rs" | wc -l | tr -d ' '
  printf -- "- origin_types references in Rust app code: "
  rg -n "origin_types::|use origin_types" "$ROOT/app/src" | wc -l | tr -d ' '
  printf -- "- runtime identity references: "
  rg -n "origin-server|origin-mcp|Origin|com\\.origin|origin-relay|originmemory|\\.config/origin-mcp" \
    "$ROOT/app" "$ROOT/src" "$ROOT/package.json" "$ROOT/README.md" "$ROOT/Cargo.toml" | wc -l | tr -d ' '
  printf -- "- stale taxonomy references: "
  rg -n "\\bconcept\\b|\\bgoal\\b|\\bdomain\\b" "$ROOT/src" "$ROOT/app/src" "$ROOT/app/tests" "$ROOT/package.json" "$ROOT/README.md" | wc -l | tr -d ' '
  printf -- "- source files under app/src and src: "
  rg --files "$ROOT/app/src" "$ROOT/src" | wc -l | tr -d ' '
  echo
  echo "## Artifacts"
  echo "- tauri-ts-outline.txt"
  echo "- api-rs-outline.txt"
  echo "- search-rs-outline.txt"
  echo "- frontend-invokes.txt"
  echo "- rust-structs.txt"
} > "$OUT/summary.md"

echo "Inventory written to $OUT"
