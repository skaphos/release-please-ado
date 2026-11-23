# Guide: release-please for a GitHub repo built on Azure Pipelines

Use this guide when source code lives on **github.com, GHE.com (data residency), or GitHub Enterprise Server**, and enterprise rules require CI to run on **Azure Pipelines** instead of GitHub Actions. The result is the same as `googleapis/release-please-action`:

1. Every push to `main` opens or updates a rolling release PR, containing the changelog and version bumps.
2. Merging that PR creates the tag and the release (or only the tag, in `tag-only` mode).
3. Later stages can gate on `releases_created`.

The [research notes](../research.md) explain why it is built this way.

## 0. Prerequisites

| Need | Why |
| --- | --- |
| A GitHub App (one per org or enterprise) | Mints short-lived, repo-scoped tokens for the release work. It is not a personal PAT. |
| An Azure Key Vault plus a variable group linked to it | Stores the App's private key outside YAML. |
| A GitHub service connection in Azure DevOps | Lets Azure Pipelines read the repo and this template repository. |
| Node 22+ on the agent | release-please 17.10 and later require it. Microsoft-hosted `ubuntu-24.04` works. |
| *(GHES only)* Azure DevOps can reach the GHES host | Required for YAML CI triggers. Otherwise use self-hosted agents with scheduled triggers. |

## 1. Create the GitHub App

On github.com or GHE.com go to **Organization settings → Developer settings → GitHub Apps → New**. On GHES the path is the same, under `https://HOST/organizations/ORG/settings/apps`.

- **Webhook:** off.
- **Repository permissions:**
  - **Contents:** read and write
  - **Pull requests:** read and write
  - **Issues:** read and write (labels and comments)
  - **Metadata:** read
  - Add **Workflows: read and write** only if release PRs touch `.github/workflows/**`.
- **Where can this be installed:** only this account.

After creating it:

1. Note the **App ID** or the **Client ID**. Either works as the JWT issuer.
2. Generate a **private key** (`.pem`).
3. **Install** the App on the repositories that will release.

> **Skaphos orgs:** reuse the existing `skaphos-release-bot` App. Do not create another one. The variable names below follow the org convention (`RELEASE_BOT_APP_ID`, `RELEASE_BOT_PRIVATE_KEY`).

## 2. Store the credentials in Key Vault

```sh
az keyvault secret set --vault-name kv-release --name RELEASE-BOT-PRIVATE-KEY --file app.private-key.pem
az keyvault secret set --vault-name kv-release --name RELEASE-BOT-APP-ID --value 123456
shred -u app.private-key.pem
```

Next, link the vault to a variable group:

1. In Azure DevOps go to **Pipelines → Library → + Variable group**. Name it `release-bot` and turn on *Link secrets from an Azure key vault*.
2. Add both secrets.
3. Key Vault secret names can't contain `_`, so the variables come out as `RELEASE-BOT-APP-ID` and `RELEASE-BOT-PRIVATE-KEY`. Pass those names to the template parameters: `appId: $(RELEASE-BOT-APP-ID)` and `privateKeyVariable: RELEASE-BOT-PRIVATE-KEY`. Or define `RELEASE_BOT_*` aliases in a second, non-linked group.
4. Under **Pipeline permissions**, allow only the release pipelines. Add an **Approvals and checks** gate if your change process requires one.

The templates map the private key into the minting step's `env:` explicitly, because secret variables are never exposed to scripts automatically. Newlines that the secret store flattened are repaired automatically.

## 3. Make this template repository available

The consumer pipeline references this repository as a `resources.repositories` entry, so it needs a service connection that can read it.

- **This repo as-is:** a `type: github` resource with `name: skaphos/release-please-ado`.
- **Mirrored internally** (common in regulated orgs): mirror or fork it into your GHE org or Azure Repos, then use `type: githubenterprise` or `type: git` respectively.
- **Pin a tag** (`ref: refs/tags/vX.Y.Z`), never `main`. The templates run with your release credentials.

## 4. Add release-please config to the repository

If the repository already used `release-please-action` with manifest config, keep `release-please-config.json` and `.release-please-manifest.json` exactly as they are.

Otherwise, start from [`examples/github-enterprise/`](../../examples/github-enterprise/), or let release-please bootstrap them:

```sh
npx release-please@17.11.2 bootstrap --token "$TOKEN" --repo-url acme/widgets \
  --release-type go --api-url https://github.acme.internal/api/v3 \
  --graphql-url https://github.acme.internal/api
```

On **GHES**, set `"changelog-host": "https://HOST"` in the config. Otherwise some changelog links point at github.com (googleapis/release-please#2351).

## 5. Create the pipeline

Copy [`examples/github-enterprise/azure-pipelines.release.yml`](../../examples/github-enterprise/azure-pipelines.release.yml) into the repo, for example as `.azure-pipelines/release.yml`. Then in Azure DevOps go to **Pipelines → New pipeline → GitHub** (or **GitHub Enterprise Server**), pick the repo, and choose *Existing Azure Pipelines YAML file*.

Key settings:

```yaml
trigger:
  batch: true            # serialize runs (Actions `concurrency` equivalent)
  branches: { include: [main] }
pr: none

jobs:
  - template: templates/jobs/release-please.yml@release_please_ado
    parameters:
      owner: acme
      repository: widgets
      apiUrl: https://github.acme.internal/api/v3   # GHES only
      variableGroups: [release-bot]
      releaseMode: github-release                   # or tag-only / none
```

Notes:

- **Triggers.** They must be in this file, not in a template, and cannot use variables. Do not trigger on `release-please--*` branches; PR validation covers them.
- **Never put `[skip ci]` in the release PR title or body.** The merge commit must trigger the run that tags.
- **Release PR CI.** PRs opened with the App token fire normal webhooks, so your regular PR pipeline and required checks run on them. This is unlike `GITHUB_TOKEN` in Actions.

## 6. Choose a release mode

| `releaseMode` | Creates | Use when |
| --- | --- | --- |
| `github-release` (default) | GitHub Release + tag | Matches release-please-action defaults. |
| `tag-only` | Annotated tag only. The release PR is still relabeled `autorelease: tagged`. | Another tool creates the GitHub Release, such as goreleaser on a tag build. This is the Skaphos pattern, and it replaces the custom "push the tag myself" shell step. |
| `none` | Nothing (PR phase only) | Rarely. Merged release PRs will then block the next PR until something tags them. |

## 7. Use the outputs

The job publishes the action's outputs on step `release_please`. Root-package outputs keep their names. Outputs for a package at a non-root path use a sanitized name: `packages/foo--tag_name` becomes `packages_foo__tag_name`. See [reference/templates.md](../reference/templates.md#outputs).

```yaml
- stage: publish
  dependsOn: release_please
  condition: eq(dependencies.release_please.outputs['release_please.release_please.releases_created'], 'true')
  variables:
    tagName: $[ stageDependencies.release_please.release_please.outputs['release_please.tag_name'] ]
```

## 8. Enterprise network controls

| Control | Setting |
| --- | --- |
| No public npm | `npmRegistry: https://pkgs.dev.azure.com/ORG/_packaging/FEED/npm/registry/`. The feed needs an npmjs upstream, or an allow-list of the lockfile's packages. The build identity needs at least *Feed and Upstream Reader*. |
| No nodejs.org | `nodejsMirror: https://mirror.internal/node/`, or `installNode: false` with Node preinstalled on self-hosted agents. |
| HTTP(S) proxy | Set the `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` pipeline variables. The templates set `NODE_USE_ENV_PROXY=1` so Node's `fetch` honors them. release-please's own proxy option does nothing (googleapis/release-please#2838). |
| GHES with a private CA | Set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` on the agent. |

## 9. First run checklist

1. Run the pipeline once with `dryRun: true`. The log shows the release PR it *would* open.
2. Remove `dryRun`, then push a `feat:` commit to `main`. A PR titled `chore(main): release X.Y.Z` appears, labeled `autorelease: pending`.
3. Merge it. The next run creates the release or tag, relabels the PR `autorelease: tagged`, comments on it, and sets `releases_created=true`.
4. Make the template repository, the pipeline YAML, and the release-please config code-owner protected (`CODEOWNERS`).

When something fails, see [troubleshooting.md](troubleshooting.md).
