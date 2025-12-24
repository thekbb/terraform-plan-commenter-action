# Terraform Plan Commenter Action

[![CI](https://github.com/thekbb/terraform-plan-commenter-action/actions/workflows/test.yml/badge.svg)](https://github.com/thekbb/terraform-plan-commenter-action/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/thekbb/terraform-plan-commenter-action/branch/main/graph/badge.svg)](https://codecov.io/gh/thekbb/terraform-plan-commenter-action)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action that runs `terraform plan` and posts a formatted comment to your pull request.
Subsequent pushes to the PR's branch will update the existing comment with the latest plan.

This makes it easy for reviewers (who won't have access to run terraform plan)
to quickly and easily see what infrastructure changes would be applied by the PR.

![screenshot](images/pr-comment-screenshot.png)

## Features

- **Updates existing comments** instead of creating duplicates
- **Collapsible sections** for state refresh output
- **Handles large plans** gracefully with truncation
- **Import support** — shows import counts in summary
- **Multi-directory support** via `working-directory` input (for mono repos)
- **Terraform workspace support** — works with multiple workspaces (dev/staging/prod)
- **Safe concurrent runs** — unique comments per workspace/directory combination
- **Accessibility themes** — colorblind-friendly emoji options

## Usage

```yaml
name: Terraform Plan

on:
  pull_request:
    branches: [main]

jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      id-token: write  # If using OIDC

    steps:
      - uses: actions/checkout@v6

      # Configure your cloud credentials (example: AWS OIDC)
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789:role/my-role
          aws-region: us-east-2

      # Run the plan
      - uses: thekbb/terraform-plan-commenter-action@v1
```

## Inputs

| Input | Description | Required | Default |
| ----- | ----------- | -------- | ------- |
| `github-token` | GitHub token for posting PR comments | No | `${{ github.token }}` |
| `working-directory` | Directory containing Terraform configuration | No | `.` |
| `terraform-version` | Terraform version to use | No | `latest` |
| `setup-terraform` | Whether to setup Terraform (set `false` if already configured) | No | `true` |
| `init-args` | Additional arguments for `terraform init` | No | `''` |
| `plan-args` | Additional arguments for `terraform plan` | No | `''` |
| `summary-theme` | Emoji theme: `default`, `colorblind`, or `minimal` | No | `default` |

## Outputs

| Output | Description |
| ------ | ----------- |
| `plan-exit-code` | Exit code from terraform plan (`0`=no changes, `1`=error, `2`=changes) |
| `has-changes` | Whether the plan has changes (`true`/`false`) |
| `plan-stdout` | Standard output from terraform plan |

## Examples

### Specific Terraform Version

```yaml
- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    terraform-version: '1.14.3'
```

### Subdirectory / Monorepo

```yaml
- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    working-directory: 'infrastructure/'
```

### Var Files

```yaml
- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    plan-args: '-var-file=prod.tfvars'
```

### Skip Terraform Setup

If you're using a matrix or already have Terraform configured:

```yaml
- uses: hashicorp/setup-terraform@v3
  with:
    terraform_version: '1.14.3'
    terraform_wrapper: false  # Important if capturing output

- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    setup-terraform: 'false'
```

### Colorblind-Friendly Theme

```yaml
- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    summary-theme: 'colorblind'
```

Available themes:

| Theme | Import | Create | Update | Destroy |
| ----- | ------ | ------ | ------ | ------- |
| `default` | 🔵 | 🟢 | 🟡 | 🔴 |
| `colorblind` | 📥 | ➕ | ✏️ | ➖ |
| `minimal` | [import] | [create] | [update] | [destroy] |

## Workspaces & Concurrent Runs

The action automatically detects your Terraform workspace and supports concurrent runs:

- **Workspaces**: Detects the current workspace (via `terraform workspace show`) and creates separate comments for each workspace (dev/staging/prod)
- **Monorepos**: Each `working-directory` gets its own independent comment
- **Concurrent runs**: Matrix builds or parallel jobs running different workspace/directory combinations maintain separate comments

### Running in a specific workspace

Select the workspace before running the action:

```yaml
- name: Select Terraform workspace
  run: terraform workspace select staging || terraform workspace new staging
  working-directory: ./infrastructure

- uses: thekbb/terraform-plan-commenter-action@v1
  with:
    working-directory: ./infrastructure
```

### Matrix example (multiple workspaces)

```yaml
strategy:
  matrix:
    workspace: [dev, staging, prod]

steps:
  - uses: actions/checkout@v6

  - name: Configure AWS
    uses: aws-actions/configure-aws-credentials@v5
    with:
      role-to-assume: arn:aws:iam::123456789:role/terraform-${{ matrix.workspace }}
      aws-region: us-east-1

  - name: Select workspace
    run: terraform workspace select ${{ matrix.workspace }} || terraform workspace new ${{ matrix.workspace }}

  - uses: thekbb/terraform-plan-commenter-action@v1
```

Each workspace gets its own independent PR comment that updates separately!

## PR Comment Preview

The action posts a comment like this:

> ### Terraform Plan
>
> <details><summary>🔵 <b>import</b> <code>2</code> · 🟢 <b>create</b> <code>3</code> ·
> 🟡 <b>update</b> <code>1</code> · 🔴 <b>destroy</b> <code>0</code></summary>
>
> ```terraform
> Terraform used the selected providers to generate the following execution plan...
> ```
>
> </details>
>
> *Pusher: @username, Action: `pull_request`*

## Security

For strict environments, pin to a full semantic version or full SHA:

```yaml
uses: thekbb/terraform-plan-commenter-action@<full-commit-sha>
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.
