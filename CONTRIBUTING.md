# Contributing

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/thekbb/terraform-plan-action.git
cd terraform-plan-action

# Install dependencies
npm install

# Run tests
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

## Project Structure

```text
terraform-plan-action/
├── action.yml              # Action definition
├── scripts/
│   ├── helpers.cjs         # Exported helper functions
│   ├── format-comment.js   # Main script (used by github-script)
│   └── format-comment.test.js
├── .github/
│   └── workflows/
│       └── test.yml        # CI workflow
├── package.json
└── eslint.config.js
```

## Running Tests

```bash
npm test                    # Run once
npm run test:watch          # Watch mode
```

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Run tests and lint (`npm test && npm run lint`)
5. Commit with a descriptive message
6. Push and open a PR

## No Build Step Required

This action uses `github-script` and plain JavaScript, so there's no build step.
Just commit your changes to the JS files directly.

## Code Style

- ESLint enforces style rules
- Prefix unused function arguments with `_` (e.g., `_core`)
- Use single quotes for strings
- Always use semicolons
