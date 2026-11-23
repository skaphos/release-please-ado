# Guide: release-please workflow for Azure Repos

**Status:** release-please does not support Azure Repos upstream (googleapis/release-please#1954, closed *not planned*). This page covers:

- what that means
- the options available today
- the adapter this repository plans to ship to close the gap

If your code can live on GitHub Enterprise with only CI on Azure Pipelines, use the [GitHub Enterprise guide](github-enterprise.md) instead. That path has full parity today.

## What has to be reproduced

| release-please behavior | Azure Repos equivalent |
| --- | --- |
| Rolling release PR on `release-please--branches--main` | Git Pull Requests REST API, or `az repos pr create` |
| `autorelease: pending` / `autorelease: tagged` labels | PR labels REST API (`.../pullRequests/{id}/labels`, `vso.code_write`). `az repos pr update` cannot set labels. |
| Commit history with associated PRs | Commits API, plus `pullRequestQuery` / merge-commit lookup |
| GitHub Release | **No equivalent.** Use an annotated tag with the notes as the message. Assets go to Pipeline artifacts, Universal Packages, or the wiki. |
| Tag creation | Annotated Tags REST API, or `git push` with `persistCredentials` |
| Commit as the bot | The build service identity through `System.AccessToken`, or an Entra workload identity ("Azure DevOps" service connection) |

## Permissions for the build identity

The identity is `{Project} Build Service ({Org})` when *Limit job authorization scope* is on. Otherwise it is `Project Collection Build Service ({Org})`. Grant it these on the repository's Security tab:

- **Contribute**
- **Create branch**
- **Create tag**
- **Contribute to pull requests**
- **Force push**, scoped to the release branch only if the tool rewrites that branch

A release-PR flow does **not** need *Bypass policies when pushing* or *Bypass policies when completing pull requests*. If you find yourself granting those, the tool is pushing to `main` directly. That defeats the review gate.

If *Protect access to repositories in YAML pipelines* is on, the token only reaches repositories named in `checkout` steps.

## Azure Repos pitfalls

These apply to any tool:

1. **Merge commit subjects.** Merge and squash commits default to `Merged PR 123: <title>`, which conventional-commit parsers ignore.
   - Use a squash-merge policy, and set the completion message to the PR title (`completionOptions.mergeCommitMessage`), or
   - use a tool that strips the prefix.
2. **PR description length.** Descriptions are reportedly capped at 4,000 characters (unverified), so put long changelogs in `CHANGELOG.md`, not the PR body.
3. **No YAML `pr:` triggers.** PR validation comes from a **Build Validation** branch policy on `main`.
4. **CI loops.** Pushes by the build identity trigger CI like any other push. Exclude the release branch from `trigger:`.

## Options

### Option 1: monkescience/yeet (interim recommendation)

[yeet](https://github.com/monkescience/yeet) is a Go single binary. It implements the release-PR model on GitHub, GitLab and **Azure DevOps**:

- labels compatible with release-please
- annotated tags as releases
- monorepo targets
- a [migration guide from release-please](https://github.com/monkescience/yeet/blob/main/docs/migrate-from-release-please.md)

Risks to accept explicitly:

| Risk | Mitigation |
| --- | --- |
| One maintainer, pre-1.0, created 2026-02 | Pin a version; time-boxed proof of concept; keep this repo's adapter as the exit path |
| Telemetry is **on by default** (TelemetryDeck) | `DO_NOT_TRACK=1` in the pipeline, or `telemetry.enabled: false` |
| Distributed via `ghcr.io` | Mirror the image into your ACR, pinned by digest, or build from source |
| No language `release-type` strategies | List every version file explicitly. Markers change from `x-release-please-*` to `x-yeet-*`. |

Authentication on Azure DevOps uses `AZURE_DEVOPS_SYSTEM_ACCESSTOKEN: $(System.AccessToken)` plus the permissions above. Follow yeet's own [CI docs](https://github.com/monkescience/yeet/blob/main/docs/ci.md). This repository does not ship a yeet template, because its flags were not validated here.

### Option 2: build it from parts

Use git-cliff (which has an Azure DevOps remote), commitizen, or cocogitto to compute the next version and changelog. Then script the rest:

1. Force-push `release/next` with the bumped files.
2. `az repos pr create --labels "autorelease: pending"`, or update the PR through REST.
3. On merge to `main`, detect the release commit, push an annotated tag, and relabel the PR.

This gives full control but makes you the maintainer of a release tool. It also loses release-please's language strategies and manifest semantics.

### Option 3: release-please with an Azure Repos `Scm` adapter (planned)

Since 17.5.0 the release-please library defines an internal `Scm` interface. `Manifest.fromManifest()` accepts any implementation of it. An `AzureReposScm` would let **upstream release-please keep doing the work**:

- release strategies
- updaters
- changelog
- manifest and monorepo plugins

The adapter only translates the roughly 25 SCM calls into Azure DevOps REST. That is the only route to *full* duplication, including existing `release-please-config.json` files working unchanged. See [design/azure-repos-scm.md](../design/azure-repos-scm.md) for the design and work plan.

## Comparison

| | release-please config reuse | Language strategies | Release PR + labels | Maintenance burden | Available |
| --- | --- | --- | --- | --- | --- |
| yeet | Partial (migration) | No | Yes | External, bus factor 1 | Now |
| Build from parts | No | No | Yes, if you build it | High, yours | Now |
| `AzureReposScm` adapter | **Yes, unchanged** | **Yes** | Yes | Medium: track the `Scm` interface | Planned (this repo) |

Tools that do **not** fit Azure Repos are recorded in [research.md §7](../research.md#7-azure-repos-as-the-source):

- semantic-release, release-it and GitVersion have no release PR.
- knope, release-plz, releasaurus and changesets have no Azure DevOps forge.
