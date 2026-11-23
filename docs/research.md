# Research: running release-please on Azure DevOps

Researched 2026-11-22. Each claim is tagged:

- **[V]**: verified against source code or primary docs.
- **[S]**: comes from secondary sources.
- **[U]**: unverified, needs validation in a real Azure DevOps org.

The [validation checklist](#validation-checklist) at the end lists every [U] item.

## 1. What release-please is

- **Package and runtime.** The `release-please` npm package is **17.11.2**, published 2026-08-24, Apache-2.0. It requires **Node >= 22**; that requirement arrived in 17.10.0. [V] `npm view release-please`, package `engines`
- **The action.** `googleapis/release-please-action` is **v5.0.0** (2026-04-22). It runs on `node24` and depends on `release-please ^17.6.1`. [V]
- **The action is a thin wrapper.** Its `src/index.ts` does three things:
  1. Calls `GitHub.create(...)`.
  2. Runs `Manifest.createReleases()`, unless `skip-github-release` is set.
  3. Runs `Manifest.createPullRequests()`, unless `skip-github-pull-request` is set.

  It loads a fresh Manifest for each phase and maps the results to outputs. [V] `src/index.ts`

  So the action itself carries no GitHub Actions-specific logic. Anything that can run Node can reproduce it.

### CLI vs. library

The CLI (`release-please release-pr`, `release-please github-release`) works fine from any CI system. This repository still drives the **library** from [`scripts/release-please-run.mjs`](../scripts/release-please-run.mjs) for three reasons:

1. **The action's outputs.** The CLI prints logs, not the action's structured outputs (`releases_created`, `tag_name`, `version`, `pr`, ...). Reproducing those requires the `CreatedRelease[]` and `PullRequest[]` values the library returns. [V]
2. **Proxies.** The CLI has no `--proxy-server` flag. [V]
3. **`tag-only` mode** requires replacing `GitHub.createRelease`; see §6.

Useful CLI facts for one-off use:

- `--api-url` and `--graphql-url` default to `https://api.github.com`.
- If the value of `--token`, `--api-url` or `--graphql-url` contains `/` or `\`, it is treated as a file path and the file is read. This is useful for secret files.
- In manifest mode, most strategy flags are ignored. Only `fork`, `labels`, `skipLabeling`, `releaseLabels`, `snapshotLabels`, `signoff`, `draft` and `draftPullRequest` are passed through. Everything else must live in `release-please-config.json`.

[V] `build/src/bin/release-please.js`

### Library API used

```ts
GitHub.create({ owner, repo, token, apiUrl, graphqlUrl, defaultBranch, proxy?, fetch? }): Promise<GitHub>
Manifest.fromManifest(github, targetBranch, configFile?, manifestFile?, overrides?, path?, releaseAs?)
Manifest.fromConfig(github, targetBranch, releaserConfig, overrides?, path?)
manifest.buildReleases() / buildPullRequests()        // dry run
manifest.createReleases() / createPullRequests()
```

[V] `build/src/github.d.ts` and `build/src/manifest.d.ts`

## 2. Supported source hosts: GitHub only

- **Upstream position.** Issue [#1954](https://github.com/googleapis/release-please/issues/1954) ("Can release-please be used with Azure DevOps Git repository?") was closed *not planned* on 2024-09-11. A maintainer wrote that it supports only GitHub, with no near-term plans for other vendors. [V]
- **Earlier attempts at other hosts.**
  - [#2631](https://github.com/googleapis/release-please/pull/2631) (provider abstraction plus GitLab) was closed unreviewed on 2026-04-09.
  - [#1560](https://github.com/googleapis/release-please/pull/1560) (an earlier `Scm` refactor) was closed unmerged.
  - [#1021](https://github.com/googleapis/release-please/issues/1021) (pluggable git provider) is still open.

  [V]
- **The internal `Scm` interface.** Since **17.5.0** ("create Scm abstraction", #2729) the library has one: `Manifest.fromManifest`/`fromConfig` accept any `Scm`, and `GitHub` implements it. [V] `build/src/scm.d.ts`
  - `Scm` is not exported from the package index. `package.json` has no `exports` map, though, so a deep import of `release-please/build/src/scm` works.
- **Consequence.** Source stays on GitHub (github.com, GHE.com, or GHES), and Azure Pipelines is only the runner. That gives **full parity** with release-please-action and needs no fork. This repository is scoped to that model.

## 3. GitHub API surface release-please needs

This list drives the token permissions. [V] `github.js`, `github-api.js`, `manifest.js`

- **GraphQL**
  - Commit history: `repository.ref(...).target.history`, including `associatedPullRequests` with labels, head ref, merge commit and files.
  - Merged-PR iteration.
  - Releases.
- **REST: commits and tags.** `repos.get` (default branch), `GET commits/{ref}`, `GET tags`.
- **REST: PRs.** `pulls.create`, `get`, `update`, `list`.
- **REST: issues.** `issues.addLabels`, `removeLabel`, `createComment`.
- **REST: releases.** `repos.createRelease` with `target_commitish`, which also creates the tag. `git.createRef` is used only for `force-tag-creation`. `repos.generateReleaseNotes` is also called.
- **REST: git data, via code-suggester.** `getRef`, `createRef`, `updateRef`, `getCommit`, `createTree`, `createCommit`, `createOrUpdateFileContents`. release-please never runs `git` locally; every change goes through the API.
- **Branches.**
  - `release-please--branches--<target>`
  - `release-please--branches--<target>--components--<component>`
  - `release-please--branches--<target>--groups--<group>`
- **Labels.**
  - New release PRs get `autorelease: pending`.
  - After release it is swapped for `autorelease: tagged`.
  - `autorelease: snooze` marks a closed PR as snoozed.
  - `autorelease: snapshot` is used for Java snapshots.
  - Merged release PRs are found by having **all** of the configured labels. So `skip-labeling` breaks release detection unless you label PRs some other way.

### Required order: releases, then the release PR

If any merged PR still carries `autorelease: pending`, `createPullRequests()` aborts with *"There are untagged, merged release PRs outstanding - aborting"*. [V] `manifest.js`

So the run on main must do `github-release` first (which tags and relabels) and `release-pr` second. The action uses this order, and so do our templates.

### Token permissions

For a GitHub App or fine-grained token:

- Contents: read/write
- Pull requests: read/write
- Issues: read/write (labels and comments)
- Metadata: read

Add Workflows: read/write only if release PRs edit `.github/workflows/**`. [V] action README; App mapping [U]

Fine-grained PATs historically failed against GraphQL (#1893), and the maintainers recommend a **GitHub App**. [V]

### The `GITHUB_TOKEN` caveat does not apply here

In GitHub Actions, PRs and pushes made with the built-in `GITHUB_TOKEN` do not trigger further workflow runs. From Azure Pipelines you use a GitHub App installation token, so normal webhooks fire. Release PRs therefore get CI, and merges trigger the release pipeline. [U, expected from webhook semantics]

## 4. GitHub Enterprise Server and GHE.com

- **GHES REST:** `https://HOST/api/v3`. [V]
- **GHES GraphQL:** `https://HOST/api`, because `@octokit/graphql` appends `/graphql`. The action strips a trailing `/graphql` for the same reason. Bare-host URLs fail (#1618). [V]
- **GHE.com (data residency):** the API is `https://api.<tenant>.ghe.com` and the web host is `https://<tenant>.ghe.com`. [S] GitHub data-residency docs
- **Changelog links.** On GHES some changelog and release links point at github.com ([#2351](https://github.com/googleapis/release-please/issues/2351), open). Set `"changelog-host": "https://HOST"` in `release-please-config.json`. [V]
- **Minimum GHES version.** None is published. release-please uses `associatedPullRequests`, PR `files`, and `generateReleaseNotes`, which very old GHES releases may lack. [U]

[`deriveUrls()`](../scripts/release-please-run.mjs) derives the GraphQL and web URLs from `apiUrl` for all three host types.

## 5. Azure Pipelines integration (GitHub-hosted source)

### Connecting the GitHub repo

Sources: [Learn: GitHub](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github) and [Learn: GHES](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/github-enterprise)

- **github.com and GHE.com.** Use the **Azure Pipelines GitHub App** connection. Microsoft recommends it, and it enables GitHub Checks. GHE.com has been supported since sprint 260. [V]
- **GHES.** There is no GitHub App for GHES; use a PAT, OAuth, or username and password. YAML triggers work **only if Azure DevOps can reach the GHES host** (inbound allowlisting plus public DNS). Otherwise you are limited to scheduled or manual runs. Agents only need outbound access to the host. [V]

### Getting a GitHub token into a script

- **Service connection tokens.** These are **not available to scripts**. Tasks receive them through endpoint authorization. The `persistCredentials` git credential is the Azure Pipelines app's token and has no `contents:write`, so do not build on it. [U, consistent with docs]
- **`GitHubRelease@1`.** It only accepts OAuth or PAT connections, not App connections, and duplicates what release-please already does. Not used. [V]
- **Recommended: mint a GitHub App installation token at run time.**
  1. Sign an RS256 JWT with `iat` 60 seconds in the past, `exp` no more than 10 minutes ahead, and `iss` set to the App ID or Client ID.
  2. Call `GET /repos/{o}/{r}/installation`.
  3. Call `POST /app/installations/{id}/access_tokens`, narrowed with `repositories` and `permissions`.

  The token lives **1 hour**. [V] [GitHub docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

  [`scripts/mint-github-app-token.mjs`](../scripts/mint-github-app-token.mjs) does this with no npm dependencies, and [`scripts/revoke-github-token.mjs`](../scripts/revoke-github-token.mjs) revokes the token at job end.
- **Stronger variant: sign in Key Vault.** Sign the JWT with `az keyvault key sign` so the private key never leaves Key Vault. This needs the *Key Vault Crypto User* role on the key, and is the pattern Microsoft's beachball auth helper uses. [S] It is planned as a template option; see [HANDOFF.md](../HANDOFF.md).
- **Prior art.** There is no first-party Azure Pipelines "create GitHub App token" task. GitHub's blog sample ([tspascoal/azure-pipelines-create-github-app-token-task](https://github.com/tspascoal/azure-pipelines-create-github-app-token-task)) is not on the Marketplace. [V]
- **Secret variables.** Secret variables and Key Vault-linked variable groups are **not mapped into script env automatically**; the templates map them with `env:`. [U, standard behavior]

### Triggers and loop avoidance

[V] Learn: GitHub triggers and git commands

- Use `trigger: { batch: true, branches: { include: [main] } }` and `pr: none`.
  - `batch` serializes runs, standing in for the Actions `concurrency` group.
  - Triggers must be in the root YAML, not a template, and cannot use variables.
- Skip strings: `[skip ci]`, `[ci skip]`, `skip-checks: true`, `[skip azp]`, `***NO_CI***`.
  - Do **not** put a skip string in release PR titles. The release PR's merge commit must trigger the run that tags.
- Leave `release-please--*` branches out of `trigger`. The PR build validates them.

### Node and npm on locked-down agents

- **Node.** `UseNode@1` accepts `version` and `nodejsMirror` (the mirror input exists only on ADO Services). Alternatively, preinstall Node 22+ on self-hosted agents. [V] [Learn](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/use-node-v1)
- **Internal npm feed.** Point an Azure Artifacts npm feed at the npmjs upstream and authenticate with `npmAuthenticate@0`. The templates write `.npmrc` and run `npm ci` against the committed lockfile; release-please has about 160 transitive packages, which security teams can allow-list. [S]
- **Caching.** `Cache@2` caches npm's download cache, not `node_modules`. [S]

### Proxies

release-please's `GitHub.create({proxy})` builds an `https-proxy-agent`, but Octokit 8 uses native `fetch`, which ignores the agent. The proxy is silently unused ([#2838](https://github.com/googleapis/release-please/issues/2838), fix PR #2846 unmerged). [V]

The templates set **`NODE_USE_ENV_PROXY=1`**, which makes Node's fetch honor `HTTPS_PROXY`/`NO_PROXY`. The Node 22 minor that introduced the variable is [U]. The templates default to Node 24.

## 6. `tag-only` mode (Skaphos pattern)

Skaphos repositories set `skip-github-release: true`, so goreleaser can own the GitHub Release. With release-please-action, that also stops release-please from creating the tag and from relabeling the release PR. Each repo then needs a custom shell step that:

- parses the merge commit
- pushes the tag
- flips the label, so the next run doesn't abort on an untagged, merged release PR

See `oiax/.github/workflows/release-please.yml`.

`RP_RELEASE_MODE=tag-only` replaces `GitHub.createRelease` with a version that creates an **annotated tag** through the git data API (`POST git/tags` and then `POST git/refs`). Everything else in `Manifest.createReleases()` stays the library's own:

- the PR comment
- the `pending` → `tagged` label swap
- duplicate-tag handling, via `DuplicateReleaseError`

[V] `manifest.js` `createReleasesForPullRequest`

Tags pushed this way are created by the App. In orgs whose tag rulesets let only the release bot create `v*` tags, that is exactly the identity that's allowed.

## 7. Out of scope: Azure Repos as the source

Source code stays on GitHub; only CI runs on Azure Pipelines. Hosting code in Azure Repos would mean running a release-please fork or a different tool, so it is out of scope.

Recorded for completeness:

- Upstream will not add Azure Repos (#1954).
- An adapter would have to implement the internal `Scm` interface, about 25 methods.
- The closest existing tool is [monkescience/yeet](https://github.com/monkescience/yeet): pre-1.0, one maintainer, telemetry on by default.

## Validation checklist

These items need a real Azure DevOps org before v1.0. They are tracked in [HANDOFF.md](../HANDOFF.md).

- [ ] The templates expand and run: `runs` preview API or a real pipeline.
- [ ] Output variable references across jobs and stages resolve with the documented names.
- [ ] PRs opened by the App token trigger Azure Pipelines PR builds and GitHub required checks.
- [ ] `NODE_USE_ENV_PROXY=1` works through a corporate proxy on the pinned Node.
- [ ] A GHES end-to-end run, plus a GraphQL URL check.
- [ ] `tag-only` against a repo with tag rulesets.
