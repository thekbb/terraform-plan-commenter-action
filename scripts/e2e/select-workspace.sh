#!/usr/bin/env bash

set -euo pipefail

working_directory="${1:?expected Terraform working directory}"
workspace="${2:?expected Terraform workspace name}"

cd "$working_directory"
terraform workspace select "$workspace" || terraform workspace new "$workspace"
