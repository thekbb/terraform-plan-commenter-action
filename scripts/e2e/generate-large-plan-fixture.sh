#!/usr/bin/env bash

set -euo pipefail

fixture_dir="${1:?expected destination fixture directory}"
resource_count="${2:-1500}"

rm -rf "$fixture_dir"
mkdir -p "$fixture_dir"

cat > "$fixture_dir/main.tf" <<'EOF'
terraform {
  required_version = ">= 1.4.0"
}
EOF

for i in $(seq 1 "$resource_count"); do
  cat >> "$fixture_dir/main.tf" <<EOF

resource "terraform_data" "example_${i}" {
  input = "terraform-plan-commenter-action-${i}"
}
EOF
done

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "fixture_dir=$fixture_dir" >> "$GITHUB_OUTPUT"
else
  echo "$fixture_dir"
fi
