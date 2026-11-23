# Handoff: continuing release-please-ado (cloud session brief)

This file is the working brief for the next session, local or cloud. Read it, [AGENTS.md](AGENTS.md), and [docs/research.md](docs/research.md) before changing anything. Update this file as work lands, and delete sections once they are done.

## Goal (from the maintainer)

> We're about to work under enterprise rules that limit us to Azure DevOps. release-please is published as a GitHub Action, which won't be available. I need to be able to fully duplicate release-please using ADO. Set it up, do full research, write it up with guides, and create templates and anything else this repo needs to support that.

**Scope (clarified by the maintainer):** source repositories stay on **GitHub**, and only CI runs on **Azure Pipelines**. Hosting code in Azure Repos is out of scope; it would require a release-please fork. Do not add Azure Repos support.

## State as of 2026-11-22

**Done in this repo** (branch `feat/initial-scaffold`, PR into `main`):

- **Research.** [docs/research.md](docs/research.md), consolidated from a source read of `release-please@17.11.2` and `release-please-action@v5.0.0` plus Microsoft Learn and GitHub docs. Claims are tagged [V]/[S]/[U].
- **Scripts.**
  - `scripts/mint-github-app-token.mjs`: GitHub App installation token, zero dependencies.
  - `scripts/revoke-github-token.mjs`
  - `scripts/release-please-run.mjs`: library runner, action-identical outputs, `github-release`/`tag-only`/`none` modes, dry run.
- **Templates.** `templates/steps/{setup,github-app-token,release-please}.yml` and `templates/jobs/release-please.yml`.
- **Example.** `examples/github-enterprise/` (consumer pipeline plus config).
- **Docs.**
  - [GitHub Enterprise guide](docs/guides/github-enterprise.md)
  - [migration guide](docs/guides/migrating-from-github-actions.md)
  - [troubleshooting](docs/guides/troubleshooting.md)
  - [template reference](docs/reference/templates.md)
  - [architecture](docs/architecture.md)
  - [ADR 0001](docs/adr/0001-drive-upstream-release-please-library.md)
- **Tests.** `npm test` runs 15 `node:test` cases, all passing.
- **Smoke test.** A dry run against `skaphos/oiax` with a read-only token produced the expected `chore(main): release 2.1.3` plan.

**Done in sibling repos:**

- **`skaphos/github-state` #7 (merged):** adds the repo to the catalog. Terraform Cloud run `run-ji16BznKMaHT7xfG` created the repo, its default branch, and vulnerability alerts. The **3 team grants failed with 404**: they raced the repo creation.
- **`skaphos/github-state` #8 (open):** `depends_on = [module.github_repositories]` on the teams module. Merging it triggers the run that adds the 3 missing grants (expected plan: +3).
- **`skaphos/skaphos-resources` #555 (open):** a `repokeeper-workspace.yaml` entry, plus a "When to deviate" pointer in `standards/go-ci-release-pattern.md`.

## Remaining work, in priority order

1. **Validate the templates in a real Azure DevOps org.** This is the [validation checklist](docs/research.md#validation-checklist). Nothing in `templates/` has run in Azure DevOps yet; only yamllint and the Node runner have been exercised.
   - Use the Pipelines *runs* preview API (`POST .../pipelines/{id}/preview` with `yamlOverride`) to catch template-expansion errors cheaply.
   - Then run a real dry run against a scratch GitHub repo, then a real release.
   - Confirm the output reference shapes in `examples/github-enterprise/azure-pipelines.release.yml`.
2. **Key Vault-side JWT signing option.** Add a `templates/steps/github-app-token-keyvault.yml` that signs the JWT with `az keyvault key sign` inside `AzureCLI@2`, so the private key never leaves the vault. The minter needs a mode that accepts a pre-signed JWT, or one that calls a signing command.
3. **Upgrade gate.** Add a weekly CI job that runs the tests against `release-please@latest`. Also diff upstream `release-please-action/src/index.ts` against `computeOutputs()`, so output drift is caught before consumers notice.
4. **Release this repo.**
   - Once validated, release-please on GitHub Actions (this repo is on github.com) cuts `v0.1.0`.
   - Consumers pin `ref: refs/tags/v0.1.0`.
   - Update the examples if the tag changes.
5. **Optional extras:**
   - A monorepo example (`node-workspace` / `linked-versions`)
   - A tag-triggered "publish" pipeline example
   - A `bootstrap` helper template

## Constraints for any session

- **The org is `skaphos`. Every commit must be DCO-signed off** with `git commit -s` as `Shawn Stratton <shawn@skaphos.io>`, and the author must match. Check the trailer before pushing.
- **Never create GitHub repos or change org settings by hand** (`gh repo create`, API calls). `skaphos/github-state` (Terraform Cloud workspace `skaphos-github-org`) is the source of truth. Open a PR there; the maintainer approves the apply.
- **Never push to `main`, force-push, or merge** unless the maintainer asks. Work on a branch and open a PR.
- **Release automation credentials.** Skaphos release automation uses the org GitHub App `skaphos-release-bot`: org variable `RELEASE_BOT_APP_ID` (or `RELEASE_BOT_CLIENT_ID`) and org secret `RELEASE_BOT_PRIVATE_KEY`. Do not introduce long-lived PATs. Org Actions default token permissions are **read-only**.
- **Commit messages:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`), because this repo releases with release-please.
- **No marketing language.** Mark anything unverified as unverified (Skaphos documentation standard).
