# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2024-12-23

### Added

- **Theme support** for accessibility via new `summary-theme` input
  - `default`: Colored circle emojis (🔵🟢🟡🔴)
  - `colorblind`: Shape-based icons (📥➕✏️➖)
  - `minimal`: Text labels (`[import]`, `[create]`, `[update]`, `[destroy]`)

## [1.0.0] - 2024-12-20

### Added

- Initial release
- Automatic PR comment creation and updates
- Collapsible state refresh sections
- Support for Terraform imports
- Multi-directory/monorepo support
- Graceful handling of large plans with truncation
- Comprehensive test coverage

[Unreleased]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/thekbb/terraform-plan-commenter-action/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/thekbb/terraform-plan-commenter-action/releases/tag/v1.0.0
