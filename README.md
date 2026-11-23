# release-please-ado

This repository brings [googleapis/release-please](https://github.com/googleapis/release-please) to **Azure DevOps Pipelines**. Release-please normally runs as a GitHub Action, or as a job in another forge's CI. Here it runs in Azure Pipelines instead, against any repository host release-please supports.

`release-please-action` is a thin wrapper around the release-please library. This repository is the Azure Pipelines version of that wrapper. It provides:

- **Templates.** Step and job templates that run the same flow as the action:
  1. Create releases for any merged release PR.
  2. Open or update the rolling release PR.
- **The same outputs.** The action's outputs (`releases_created`, `tag_name`, `version`, `pr`, and the rest) become Azure Pipelines output variables, so later stages can gate on them.
- **GitHub App tokens.** A dependency-free token minter replaces `actions/create-github-app-token`. Each token is short-lived, scoped to one repository, and revoked when the job ends.
- **Enterprise features:**
  - GHES and GHE.com URLs
  - an internal npm feed and an internal Node mirror
  - corporate proxies
  - `tag-only` mode, which creates the tag but no GitHub Release object

## Scope

This repository supplies the **runner**; upstream release-please decides which **forges** work.

- **Upstream forges are supported here.** Whatever repository hosts upstream release-please supports, this repository runs it from Azure Pipelines, without forking release-please.
- **Today that is GitHub:** github.com, GHE.com and GHES. Parity with release-please-action is full, and existing `release-please-config.json` files work unchanged. Start with [the GitHub Enterprise guide](docs/guides/github-enterprise.md).
- **If upstream adds a forge** (GitLab, Azure Repos, or anything else), this repository adds it to the runner's `forge` switch and the templates. The release logic stays upstream's.
- **Not built here:** forge support that upstream doesn't have. Adding it would mean forking release-please.

## Quickstart (GitHub repo, Azure Pipelines CI)

```yaml
trigger:
  batch: true
  branches: { include: [main] }
pr: none

resources:
  repositories:
    - repository: release_please_ado
      type: github
      endpoint: github-release-tooling
      name: skaphos/release-please-ado
      ref: refs/tags/v0.1.0

variables:
  - group: release-bot            # RELEASE_BOT_APP_ID + RELEASE_BOT_PRIVATE_KEY

jobs:
  - template: templates/jobs/release-please.yml@release_please_ado
    parameters:
      owner: acme
      repository: widgets
      # apiUrl: https://github.acme.internal/api/v3   # GHES
```

[`examples/github-enterprise/`](examples/github-enterprise/) has a complete pipeline, including a publish stage gated on `releases_created`.

## Documentation

Start at [docs/README.md](docs/README.md). The most useful pages:

- [Research findings](docs/research.md): what release-please needs from the platform, and why each design choice was made
- [GitHub Enterprise + Azure Pipelines setup guide](docs/guides/github-enterprise.md)
- [Migrating from GitHub Actions](docs/guides/migrating-from-github-actions.md)
- [Template and output reference](docs/reference/templates.md)

## Development

```sh
npm ci
npm test            # node:test unit tests
task check          # tests + YAML lint
```

## License

MIT. See [LICENSE](LICENSE).
