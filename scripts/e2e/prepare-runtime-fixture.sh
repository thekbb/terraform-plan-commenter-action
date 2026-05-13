#!/usr/bin/env bash

set -euo pipefail

fixture_dir="${1:?expected destination fixture directory}"
source_dir="${2:-fixtures/e2e/basic-plan}"

rm -rf "$fixture_dir"
cp -R "$source_dir" "$fixture_dir"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "fixture_dir=$fixture_dir" >> "$GITHUB_OUTPUT"
else
  echo "$fixture_dir"
fi
