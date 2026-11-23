# Architecture

## What this is and is not

This repository is an Azure Pipelines equivalent of `googleapis/release-please-action`. It contains:

- YAML templates
- a Node runner script that drives the **unmodified upstream** release-please library
- a dependency-free GitHub App token minter

It is **not** a fork of release-please, and it adds no versioning logic of its own. Version bumps, changelogs, language updaters and manifest plugins all come from the pinned `release-please` package.

## Moving parts

```
consumer pipeline (azure-pipelines.release.yml, trigger: main, batch)
  └─ templates/jobs/release-please.yml@release_please_ado
       ├─ checkout: release_please_ado → $(Pipeline.Workspace)/release-please-ado
       ├─ steps/setup.yml            UseNode@1 → [.npmrc + npmAuthenticate] → [Cache@2] → npm ci
       ├─ steps/github-app-token.yml scripts/mint-github-app-token.mjs
       │     JWT(RS256, App key from Key Vault-linked secret) → installation → repo-scoped token
       │     → ##vso secret variable GITHUB_TOKEN
       ├─ steps/release-please.yml   scripts/release-please-run.mjs
       │     GitHub.create(api/graphql URLs)
       │     [tag-only: replace github.createRelease with annotated tag via git data API]
       │     Manifest.fromManifest → createReleases()   (phase 1: tag/release merged release PRs)
       │     Manifest.fromManifest → createPullRequests() (phase 2: open/update release PR)
       │     computeOutputs() → ##vso output variables (+ JSON file)
       └─ scripts/revoke-github-token.mjs (always)
```

Later stages read the outputs (`releases_created`, `tag_name`, ...) to decide whether to build and publish.

## Key decisions

- **Library, not CLI.** This is the only way to reproduce the action's outputs and `tag-only` mode. See [ADR 0001](adr/0001-drive-upstream-release-please-library.md).
- **Releases before PRs, with a fresh Manifest per phase.** This matches the action. Release-please refuses to open a PR while a merged release PR is untagged.
- **GitHub App tokens.** Tokens are minted per run, scoped to one repo and a minimal set of permissions, and revoked at job end. GitHub service connection tokens are not readable by scripts, and long-lived PATs violate org policy.
- **Zero-dependency auxiliary scripts.** The minter and the revoker use only `node:crypto` and `fetch`. Only the runner needs `npm ci`, from a committed lockfile, so an internal feed can serve it.
- **`NODE_USE_ENV_PROXY=1`.** Release-please's own proxy option is a no-op on Octokit 8's fetch.

## Known limitations

- Source must be on GitHub (github.com, GHE.com, or GHES). Azure Repos needs the planned [`AzureReposScm`](design/azure-repos-scm.md).
- Template behavior in a live Azure DevOps org has not been validated yet. See the [validation checklist](research.md#validation-checklist).
- Key Vault-side JWT signing, where the private key never leaves the vault, is planned but not implemented.
