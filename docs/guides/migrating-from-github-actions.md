# Migrating from release-please-action to Azure Pipelines

This page maps a GitHub Actions release-please workflow onto this repository's templates. Your config files stay the same: `release-please-config.json` and `.release-please-manifest.json` are read by the same library.

## Input mapping

| release-please-action input | Template parameter (`templates/jobs/release-please.yml`) | Notes |
| --- | --- | --- |
| `token` | *(minted)* `appId` + `privateKeyVariable` | The job mints an App installation token. To bring your own token, use `templates/steps/release-please.yml` with `token: $(MY_TOKEN)`. |
| `release-type` | `releaseType` | Single-package mode; config files are ignored. |
| `path` | step template `path` | |
| `target-branch` | `targetBranch` | |
| `config-file` / `manifest-file` | `configFile` / `manifestFile` | |
| `skip-github-release: true` | `releaseMode: tag-only` (or `none`) | `tag-only` also creates the tag and relabels the PR. See below. |
| `skip-github-pull-request` | `skipPullRequest` | |
| `github-api-url` | `apiUrl` | `https://HOST/api/v3` for GHES |
| `github-graphql-url` | `graphqlUrl` | Derived from `apiUrl` when empty |
| `fork` | step template `fork` | |
| `proxy-server` | `HTTPS_PROXY` variable | The library's proxy option is broken upstream; Node's env proxy is used instead. |
| `changelog-host` | `"changelog-host"` in the config file | |
| `include-component-in-tag`, `versioning-strategy`, `release-as` | config file keys | Manifest mode reads these from config. |

## Output mapping

| Actions expression | Azure Pipelines expression (job `release_please`, step `release_please`) |
| --- | --- |
| `steps.rp.outputs.release_created` | `$(release_please.release_created)` (same job) |
| `needs.rp.outputs.release_created` | `dependencies.release_please.outputs['release_please.release_created']` (later job, same stage) |
| *(across stages)* | `stageDependencies.<stage>.release_please.outputs['release_please.release_created']` |
| `steps.rp.outputs['packages/foo--tag_name']` | `...outputs['release_please.packages_foo__tag_name']` |

The job template's comment and [reference/templates.md](../reference/templates.md#outputs) list every output.

## The Skaphos `skip-github-release` workaround becomes `tag-only`

Repos such as `oiax` run release-please with `skip-github-release: true`, followed by about 100 lines of shell that:

- reconciles `autorelease: pending` labels
- parses the merge commit subject
- pushes `v<version>`
- relabels the PR

Release-please has to see the tag and the `autorelease: tagged` label, or the next run aborts with *"untagged, merged release PRs outstanding"*. That is the only reason the shell exists.

`releaseMode: tag-only` performs exactly those effects inside release-please's own release phase:

- the tag is created through the API, as the App
- the same label swap and PR comment as a normal release
- duplicate tags are handled

Drop the shell steps when migrating. Your tag-triggered `release.yml` equivalent (goreleaser and so on) becomes an Azure Pipelines tag trigger or a stage gated on `releases_created`.

## Triggers and concurrency

| Actions | Azure Pipelines |
| --- | --- |
| `on: push: branches: [main]` | `trigger: { branches: { include: [main] } }` |
| `concurrency: { group: release-please, cancel-in-progress: false }` | `trigger: { batch: true }` (one run at a time; queued pushes combine) |
| `permissions:` block | GitHub App permissions plus the token's `permissions` narrowing (`templates/steps/github-app-token.yml`) |
| `on: push: tags: ['v*']` (release build) | A separate pipeline with `trigger: { tags: { include: ['v*'] } }`, or a stage gated on outputs |
