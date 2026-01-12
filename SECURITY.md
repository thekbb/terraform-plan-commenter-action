# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please
[email us](mailto:security@thekbb.net?subject=terraform-plan-commenter-action%20security%20concern)
instead of opening a public issue.

We'll respond within 48 hours and work with you to understand and address the issue.

## Security Considerations

This action:

- Requires `pull-requests: write` to post PR comments
- Uses `github.token` no additional secrets needed
- Posts plan output to a PR comment be aware that plan output may contain sensitive information.

For strict environments, pin to a full SHA:

```yaml
uses: thekbb/terraform-plan-commenter-action@<full-commit-sha>
```

Or fork this repo into your org for complete control.
I do this for all GitHub actions not owned by a vendors GitHub org.
