# Contributing

Thanks for your interest in contributing! If you have questions, aren't sure where to start, or are stuck,
reach out! I will help.

## Development Setup

Use Node.js 24 for local development.

```bash
# Clone the repo
git clone https://github.com/thekbb/terraform-plan-commenter-action.git
cd terraform-plan-commenter-action

# Install dependencies
npm install

# Run the same checks as the main CI job
npm run check

# Rebuild the checked-in runtime after changing TypeScript source
npm run build

# Run tests only
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Lint markdown
npm run lint:md

# Fix lint issues
npm run lint:fix
```

## Running Tests

```bash
npm run check              # Run lint, typecheck, build verification, docs lint, and coverage
npm run build              # Rebuild dist/ from TypeScript source
npm run build:check        # Verify dist/ matches TypeScript source
npm test                    # Run once
npm run test:watch          # Watch mode
```

The local suite tests the TypeScript plan runner with fake Terraform executables
to check exit handling, output capture, and temporary-file cleanup. Runner tests
are also TypeScript so they share the production contracts and type checking.

The repository also has GitHub-side end-to-end workflow tests in
`.github/workflows/e2e.yml`. Those jobs exercise the checked-in composite
action against real Terraform fixtures and verify the resulting PR-comment
behavior in GitHub Actions itself.

On same-repo pull requests, these tests leave one stable comment per scenario:

- smoke test
- large-plan truncation
- plan-failure

Each comment identifies itself as an automated end-to-end test artifact and is
expected to be updated by later runs of the same scenario.

## Making Changes

1. Fork the repository
1. Create a feature branch (`git checkout -b my-change`)
1. Make your changes
1. Run the local check suite (`npm run check`)
1. Commit with a descriptive message
1. Push and open a PR

## Releases

Use the workflow-driven release flow from a clean `main` branch.

Before you start, make sure `main` already contains any changelog, code, or
documentation changes you want in the release.

To sanity-check the next release version locally:

```bash
npm run release:check -- 1.2.0
```

The normal release path is:

1. Run the `Prepare Release` workflow, which always prepares the release from `main`, with the target version.
2. Review and merge the generated `release-candidate/vX.Y.Z` pull request.
3. Create and push the signed `vX.Y.Z` tag locally from the merged `main` commit.
4. Move the major tag (for example `v1`) locally to the same commit and push it.
5. Create a draft GitHub release for `vX.Y.Z`.
6. Run `Verify Draft Release` from the `vX.Y.Z` tag, with `tag=vX.Y.Z`.
7. Let `Publish Verified Release` publish the draft release after the tag and
   release metadata are re-verified.

`release:check` still validates changelog structure and release metadata
locally. `release:prepare` is intended for the GitHub workflow that prepares
the release-candidate pull request.

## Generated Runtime

This repository publishes a [composite action](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action),
with its Node.js runtime compiled from `src/` into `dist/`. Commit both the
TypeScript source and generated runtime. CI rejects stale generated files with
`npm run build:check`.

The PR comment runtime is the first incremental move to TypeScript. The action
remains composite, and other runtime boundaries can migrate independently.

## Code Style

- ESLint enforces style rules
- Prefix unused function arguments with `_` (e.g., `_core`)
- Use single quotes for strings
- Always use semicolons
