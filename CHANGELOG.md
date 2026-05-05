# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Parse the actual Terraform `Plan:` summary line when building the PR comment
  summary so unrelated resource content like `to add` does't prevent summary in comment

## [2.0.0] - 2026-04-29

### Removed

- Remove the `plan-stdout` action output from the public interface

### Changed

- Keep the full Terraform plan in a temporary file for comment generation
  instead of transporting it through GitHub Actions step outputs
- Add draft-release verification from the signed tag before publication
- Publish verified draft releases only after re-checking the signed tag,
  release metadata, and draft-release state
- Standardize CI and package metadata on Node.js `24.14.1`
- Update docs to describe the workflow-driven release process and composite
  action release model
- Prevent Dependabot from proposing Node 25 major updates while continuing to
  track the latest Node 24 line

### Added

- Workflow linting with `actionlint` and `zizmor`
- Dependency review on pull requests
- CodeQL analysis for JavaScript
- CI timeout and concurrency controls
- Add JavaScript typechecking
- Additional regression coverage for parser edge cases and non-`Error` failures

### Notes

- This is a breaking release because workflows that consumed `plan-stdout`
  directly must stop depending on that removed output

## [1.2.2] - 2026-04-16

### Fixed

- Omit the workflow run link from truncated PR comments when `GITHUB_SERVER_URL` is unavailable
- Show a neutral placeholder instead of raw refresh noise when filtered plan output is empty
- Show a neutral summary instead of partial counts when Terraform plan count fragments are malformed

### Added

- Regression coverage for truncated comments when the GitHub server URL is missing
- Coverage for all-noise filtered plan output and empty plan rendering
- Coverage for malformed and mixed-validity Terraform plan count summaries

## [1.2.1] - 2026-04-11

### Added

- Include the armored public GPG key used to sign release tags

### Changed

- Pin external GitHub Actions to full SHA
- Move the failed-plan check to a step-level `if`
- Dependency updates
- Document SHA pinning guidance, release tag usage, and signed tag verification in the README

## [1.2.0] - 2026-03-18

### Changed

- Stop including Terraform state refresh output in PR comments
- Route `init-args` and `plan-args` through Terraform command-specific
  CLI env vars internally, avoiding raw shell expansion in action steps
- Mark `init-args` and `plan-args` as trusted-only configuration in action metadata and security documentation
- Refresh workflow examples.
- Move CI and package metadata to Node.js 24
- Use GitHub comment pagination when looking up existing PR comments

### Added

- Coverage for PR comment create/update, truncation, pagination, and API failure handling in `format-comment.cjs`
- npm-based release automation for validating the changelog, creating release commits, and moving tags
  while updating README release examples

## [1.1.0] - 2024-12-23

### Added

- **Theme support** for accessibility via new `summary-theme` input
  - `default`: Colored circle emojis (🔵🟢🟡🔴)
  - `colorblind`: Shape-based icons (📥➕✏️➖)
  - `minimal`: Text labels (`[import]`, `[create]`, `[update]`, `[destroy]`)
- **Terraform workspaces support**, works with multiple Terraform workspaces (dev/staging/prod) in the same PR

### Changed

- **Comment markers now unique per workspace and directory** for safe concurrent runs
  - Enables monorepos to run plans in multiple directories simultaneously
  - Each workspace/directory combination maintains its own independent comment

## [1.0.0] - 2024-12-20

### Added

- Initial release
- Automatic PR comment creation and updates
- Collapsible state refresh sections
- Support for Terraform imports
- Multi-directory/monorepo support
- Graceful handling of large plans with truncation
- Comprehensive test coverage

[Unreleased]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.2.2...v2.0.0
[1.2.2]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/thekbb/terraform-plan-commenter-action/releases/tag/v1.0.0
