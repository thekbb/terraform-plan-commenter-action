#!/usr/bin/env bash

set -euo pipefail

expected_exit_code="${1:?expected Terraform plan exit code}"
expected_has_changes="${2:?expected has-changes output}"
expected_step_outcome="${3:-}"

if [[ "${PLAN_EXIT_CODE:-}" != "$expected_exit_code" ]]; then
  echo "Expected PLAN_EXIT_CODE=$expected_exit_code but found ${PLAN_EXIT_CODE:-<unset>}"
  exit 1
fi

if [[ "${HAS_CHANGES:-}" != "$expected_has_changes" ]]; then
  echo "Expected HAS_CHANGES=$expected_has_changes but found ${HAS_CHANGES:-<unset>}"
  exit 1
fi

if [[ -n "$expected_step_outcome" && "${STEP_OUTCOME:-}" != "$expected_step_outcome" ]]; then
  echo "Expected STEP_OUTCOME=$expected_step_outcome but found ${STEP_OUTCOME:-<unset>}"
  exit 1
fi
