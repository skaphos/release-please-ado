# Design: `AzureReposScm`, an Azure Repos backend for release-please

**Status:** proposed, not started. This is the main follow-up work for this repository; see [HANDOFF.md](../../HANDOFF.md).

## Goal

Run unmodified upstream release-please (strategies, updaters, changelog notes, plugins, manifest config) against an **Azure Repos Git** repository. The adapter implements release-please's `Scm` interface on top of the Azure DevOps REST API (7.1), so only the forge calls change.

## Why this approach

- **It stays upstream.** release-please 17.5.0+ makes `Manifest.fromManifest(scm, ...)` and `fromConfig(scm, ...)` accept any `Scm`. `GitHub` and `LocalGitHub` already implement it. [V] `build/src/scm.d.ts`
- **No fork.** Upgrading release-please means re-running the contract tests, not rebasing a fork.
- **Existing config works unchanged.** A team moving from GitHub keeps `release-please-config.json` exactly as it is.

## Constraints and risks

- **The interface is private.** `Scm` is not exported from the package index. Import it from `release-please/build/src/scm`; there is no `exports` map, so the deep import works today. Pin the release-please version exactly, and gate upgrades on the contract test suite.
- **Hard-coded GitHub assumptions.**
  - `manifest.js` builds `https://github.com/.../pull/N` links in some log and notes paths.
  - The changelog host defaults to `https://github.com`. Set `changelog-host` to the Azure Repos web URL, and override the notes builder if links must be exact.
- **No Releases.** `createRelease` creates an **annotated tag** whose message is the release notes. It returns a `ScmRelease` whose `url` points at the tag in the web UI. The optional "release publisher" hook is described below.
- **Labels.** Azure Repos PR labels are project-level tag definitions. Creating a label on a PR auto-creates the definition.
- **Merge commit messages.** The default subject is `Merged PR N: <title>`.
  - Commit parsing must strip that prefix before it reaches release-please's conventional-commit parser. Do this by wrapping the commit iterator.
  - The adapter maps each merge commit back to its PR through the PR's `lastMergeCommit`.
- **Description length.** PR descriptions are reportedly capped at 4,000 characters, unverified. Truncate the body with a link to `CHANGELOG.md` on the release branch, as release-please does for GitHub's 65,536 limit.

## Interface mapping

Method names come from `build/src/scm.d.ts` in release-please 17.11.2. Re-derive the list from the pinned version before implementing.

| `Scm` responsibility | Azure DevOps REST (7.1) |
| --- | --- |
| repository / default branch | `GET git/repositories/{repo}` → `defaultBranch` |
| commit iteration with associated PRs and files | `GET git/repositories/{repo}/commits?searchCriteria.itemVersion.version={branch}` paged. PR association: `POST git/repositories/{repo}/pullrequestquery` (type `lastMergeCommit`), or `GET pullrequests?searchCriteria.status=completed`. Files: `GET commits/{id}/changes`. |
| merged PR iteration (labels, head and base branch, merge commit) | `GET pullrequests?searchCriteria.status=completed&searchCriteria.targetRefName=refs/heads/{branch}` plus `GET pullRequests/{id}/labels` |
| find open release PR by branch | `GET pullrequests?searchCriteria.sourceRefName=refs/heads/release-please--branches--{branch}&searchCriteria.status=active` |
| create or update PR with file changes | `POST git/repositories/{repo}/pushes` (one commit with all file changes on the release branch; force-update by setting `oldObjectId` to the current tip), then `POST`/`PATCH pullrequests` |
| file contents at ref (`getFileContentsOnBranch`, `findFilesByFilename*`) | `GET items?path=...&versionDescriptor.version={branch}`, and `GET items?recursionLevel=Full` for searches |
| tags iteration | `GET refs?filter=tags/` |
| releases iteration (`releaseIterator`) | Annotated tags: `GET annotatedtags/{objectId}` for the tags found above |
| `createRelease` | `POST git/repositories/{repo}/annotatedtags` (`name`, `taggedObject.objectId`, `message`). Return `DuplicateReleaseError` on 409 or "already exists". |
| `addIssueLabels` / `removeIssueLabels` | `POST` / `DELETE pullRequests/{id}/labels/{name}` |
| `commentOnIssue` | `POST pullRequests/{id}/threads` (status `closed`, so it doesn't block completion) |
| `generateReleaseNotes` | Not supported (GitHub-only). Throw, as the GitHub implementation does when unconfigured. Only used with `changelog-type: github`. |
| fork mode | Not supported. Azure Repos forks exist, but this is out of scope for v1. |

## Authentication

1. **Default:** `System.AccessToken`, passed as `ADO_TOKEN`, used as `Authorization: Bearer`.
2. **Alternative:** an Entra workload-identity token from the "Azure DevOps" service connection (`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`).
3. **Local use only:** PAT, as Basic auth with an empty username.

## Runner integration

`scripts/release-please-run.mjs` gains `RP_FORGE=github|azure-repos`. With `azure-repos`, it builds `AzureReposScm.create({ organizationUrl, project, repository, token })` instead of `GitHub.create`. Outputs, release modes, and two-phase ordering are unchanged. `html_url` points at the tag page.

A new `templates/jobs/release-please-azure-repos.yml` will:

- check out the tools repo
- map `System.AccessToken`
- document the permission checklist from [guides/azure-repos.md](../guides/azure-repos.md)

## Test plan

1. **Contract tests.** Recorded Azure DevOps REST fixtures for each mapped call: paging, label add and remove, duplicate tag, force-update push.
2. **Manifest tests.** Run `Manifest.fromManifest(new AzureReposScm(fake))` for single-package, monorepo (`node-workspace`, `linked-versions`), and prerelease configs. Compare the produced PR file changes with the same fixtures run through release-please's own GitHub test fakes.
3. **End to end in a scratch Azure DevOps project:**
   - `feat:` commit, then the release PR appears
   - merge, then the tag and the `autorelease: tagged` label
   - the next commit opens the next PR
4. **Upgrade gate.** A CI job runs the contract tests against `release-please@latest` weekly and fails loudly when `Scm` changes.

## Work breakdown

1. Spike: implement `getDefaultBranch`, file reads, and the commit iterator. Run `debug-config` and `buildPullRequests()` dry-run against a real repo.
2. PR create and update through `pushes` and `pullrequests`, plus labels.
3. Release phase: merged-PR lookup, annotated tag, relabel, comment.
4. Runner and template integration, with docs.
5. Hardening: paging limits, retries and 429 back-off, description truncation, merge-prefix stripping.
