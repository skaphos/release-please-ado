# Template reference

All templates live under `templates/` and are referenced from a consumer pipeline as `<path>@<alias>`. The alias is the consumer's `resources.repositories` entry for this repository; the default is `release_please_ado`.

## `templates/jobs/release-please.yml`

A complete job made of these steps:

1. Check out this repository to `$(Pipeline.Workspace)/release-please-ado`.
2. Run the setup step template.
3. Mint the GitHub App token.
4. Run release-please.
5. Revoke the token (`always()`).

| Parameter | Default | Description |
| --- | --- | --- |
| `jobName` | `release_please` | Job name. Used in output references. |
| `toolsRepository` | `release_please_ado` | Alias of this repository in `resources.repositories`. |
| `pool` | `{vmImage: ubuntu-24.04}` | Agent pool object. |
| `variableGroups` | `[]` | Variable groups to attach, for example the Key Vault-linked `release-bot`. |
| `appId` | `$(RELEASE_BOT_APP_ID)` | GitHub App ID or Client ID. |
| `privateKeyVariable` | `RELEASE_BOT_PRIVATE_KEY` | **Name** of the secret variable holding the PEM. |
| `owner` | (required) | Org or user that owns the repository. |
| `repository` | (required) | Repository name, without the owner. |
| `apiUrl` | `https://api.github.com` | GHES: `https://HOST/api/v3`. GHE.com: `https://api.TENANT.ghe.com`. |
| `graphqlUrl` | derived | Only set this if the derivation is wrong for your host. |
| `targetBranch` | repository default | Branch to release from. |
| `configFile` / `manifestFile` | `release-please-config.json` / `.release-please-manifest.json` | Manifest mode files. |
| `releaseType` | `''` | Set to use single-package mode instead of manifest files. |
| `releaseMode` | `github-release` | `github-release`, `tag-only`, or `none`. |
| `skipPullRequest` | `false` | Skip the release PR phase. |
| `dryRun` | `false` | Print what would happen. Writes nothing and sets no outputs. |
| `nodeVersion` | `24.x` | Must be Node 22 or later. |
| `installNode` | `true` | Set to `false` for self-hosted agents with Node preinstalled. |
| `nodejsMirror` | `''` | Internal Node mirror for `UseNode@1`. |
| `npmRegistry` | `''` | Internal npm registry or Azure Artifacts feed URL. |
| `timeoutInMinutes` | `20` | Job timeout. |

## `templates/steps/setup.yml`

Steps:

- `UseNode@1`
- an optional internal `.npmrc` plus `npmAuthenticate@0`
- an optional npm cache (`Cache@2`)
- `npm ci` in `toolsPath`

Parameters: `toolsPath`, `nodeVersion`, `nodejsMirror`, `installNode`, `npmRegistry`, `cacheNpm`.

## `templates/steps/github-app-token.yml`

Mints an installation token. In the same job it sets the secret variable `$(GITHUB_TOKEN)`, and for later jobs the output `<name>.GITHUB_TOKEN`.

Parameters:

- `name` (default `github_token`)
- `toolsPath`
- `appId`
- `privateKeyVariable`
- `owner`
- `repositories`
- `apiUrl`
- `permissions`: a JSON string; the default is contents, pull_requests and issues, all `write`

## `templates/steps/release-please.yml`

Runs [`scripts/release-please-run.mjs`](../../scripts/release-please-run.mjs). Parameters mirror the job template, plus:

- `name` (default `release_please`)
- `forge` (default `github`; the only value until upstream adds forges)
- `token` (default `$(GITHUB_TOKEN)`)
- `repoUrl` (`owner/repo`)
- `path`
- `fork`

Use this template directly to bring your own token or your own job layout.

## Outputs

Outputs are set as output variables of the release-please step, `release_please` by default. They match `release-please-action`.

**Run-level outputs:**

| Name | When set | Value |
| --- | --- | --- |
| `releases_created` | always (unless `releaseMode: none`) | `true`/`false` |
| `paths_released` | always (unless `releaseMode: none`) | JSON array of package paths released, e.g. `[".","packages/foo"]` |
| `prs_created` | always (unless `skipPullRequest`) | `true`/`false` |
| `pr` | a PR was created or updated | JSON object of the first PR |
| `prs` | a PR was created or updated | JSON array of all PRs |

**Per-release outputs.** For each released package, these are set without a prefix for the root package (`.`). For any other path they are prefixed `<path>__`, after sanitizing.

| Name | Value |
| --- | --- |
| `release_created` | `true` |
| `tag_name` | Tag, e.g. `v1.2.3` or `foo-v0.4.0` |
| `version`, `major`, `minor`, `patch` | Parsed version |
| `sha` | Commit the release points at |
| `body` | Release notes (multi-line, escaped for the logging command) |
| `html_url` | Release page (`github-release`) or tag tree URL (`tag-only`) |
| `upload_url` | Asset upload URL (`github-release` only) |
| `id`, `name`, `draft`, `path`, `prNumber` | As returned by release-please |

**Name sanitizing.** Azure Pipelines variable names allow only letters, digits, `.` and `_`, so the action's `<path>--<key>` becomes `<sanitized path>__<key>`. Every character outside that set becomes `_`.

| Action output | Azure Pipelines output |
| --- | --- |
| `packages/foo--tag_name` | `packages_foo__tag_name` |
| `@scope/pkg--version` | `_scope_pkg__version` |

All outputs are also written as JSON to `$(Agent.TempDirectory)/release-please-outputs.json` for later steps in the same job.

## Runner environment variables

The step template sets these; set them yourself to use [`scripts/release-please-run.mjs`](../../scripts/release-please-run.mjs) outside the templates.

| Variable | Default | Description |
| --- | --- | --- |
| `RP_FORGE` | `github` | Forge to drive. Only forges upstream release-please supports; today, `github`. |
| `RP_TOKEN` | (required) | Forge token (GitHub: App installation token) |
| `RP_REPO_URL` | (required) | `owner/repo` or a full clone URL |
| `RP_API_URL` | `https://api.github.com` | REST base |
| `RP_GRAPHQL_URL` | derived | GraphQL base, without `/graphql` |
| `RP_SERVER_URL` | derived | Web base for tag links |
| `RP_TARGET_BRANCH` | repository default | |
| `RP_CONFIG_FILE` / `RP_MANIFEST_FILE` | standard names | |
| `RP_RELEASE_TYPE` / `RP_PATH` | | Single-package mode |
| `RP_RELEASE_MODE` | `github-release` | `github-release`, `tag-only`, or `none` |
| `RP_SKIP_PULL_REQUEST`, `RP_FORK`, `RP_SKIP_LABELING`, `RP_DRY_RUN` | `false` | Booleans (`true`, `1`, `yes`) |
| `RP_OUTPUT_FILE` | | Write outputs as JSON |
| `RP_OUTPUT_PREFIX` | | Prefix for output variable names |
