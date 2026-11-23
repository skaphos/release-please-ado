# ADR 0001: Drive the upstream release-please library from Azure Pipelines

- Status: accepted
- Date: 2026-11-22

## Context

Enterprise rules forbid GitHub Actions, so `googleapis/release-please-action` cannot run, but teams need the same release-PR workflow on Azure DevOps. Release-please only talks to GitHub through its API, so it does not care which CI system runs it. The action is a thin wrapper:

- `GitHub.create`
- `createReleases`
- `createPullRequests`
- output mapping

## Options considered

1. **Call the CLI from a script step** (`npx release-please github-release && release-pr`).
   - Simple.
   - No structured outputs.
   - No proxy support.
   - No `tag-only` mode.
2. **Drive the library from a small Node runner** that mirrors `release-please-action/src/index.ts`.
3. **Fork release-please, or switch tools** (semantic-release, yeet, git-cliff).
   - Loses config compatibility, or adds a maintenance burden.

## Decision

Option 2. The runner pins `release-please` exactly, through `package.json` and its lockfile. It reproduces the action's phase order and outputs. It adds `tag-only` by replacing `GitHub.createRelease`, so the library's own label and comment bookkeeping still runs.

## Consequences

- **Config portability.** Existing `release-please-config.json` and manifest files work unchanged.
- **Tracking the action.** We track the action's output contract by hand; `test/release-please-run.test.mjs` pins it.
- **Upgrades.** A release-please upgrade means bumping the pin and re-running the tests and the dry-run smoke test.
- **Azure Repos.** Source hosted in Azure Repos is out of scope. Source stays on GitHub, and only CI moves to Azure Pipelines.
