# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Make the release script resumable after partially completed release preparation
  or git/push failures

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

[Unreleased]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/thekbb/terraform-plan-commenter-action/releases/tag/v1.0.0
