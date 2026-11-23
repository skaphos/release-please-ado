# Documentation

## Start here

- [Research findings](research.md): what release-please needs from the platform, the GitHub-only constraint, and the Azure DevOps facts behind every design choice. Each claim is tagged verified, secondary, or unverified.
- [Architecture](architecture.md): how the templates, the runner, and the token minter fit together.

## Guides

- [GitHub Enterprise + Azure Pipelines](guides/github-enterprise.md): full setup for github.com, GHE.com, and GHES. This path has full parity with release-please-action.
- [Azure Repos](guides/azure-repos.md): the upstream gap, the options available today, and the planned adapter.
- [Migrating from GitHub Actions](guides/migrating-from-github-actions.md): input and output mapping, plus replacing the Skaphos `skip-github-release` shell with `tag-only`.
- [Troubleshooting](guides/troubleshooting.md)

## Reference

- [Templates, outputs and runner environment](reference/templates.md)

## Design

- [Design: `AzureReposScm`](design/azure-repos-scm.md): Azure Repos backend for release-please (proposed).
- [ADR 0001: drive the upstream release-please library](adr/0001-drive-upstream-release-please-library.md)
