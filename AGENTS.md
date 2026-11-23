# Agent guidance: release-please-ado

## Purpose

This repository runs `googleapis/release-please` from Azure DevOps Pipelines when GitHub Actions is not allowed. It ships Azure Pipelines templates, a Node runner around the upstream release-please library, a GitHub App token minter, and guides. Current state and next steps are in [HANDOFF.md](HANDOFF.md).

## Layout

| Path | Contents |
| --- | --- |
| `templates/jobs/`, `templates/steps/` | Azure Pipelines templates (the public contract) |
| `scripts/` | `release-please-run.mjs` (library runner), `mint-github-app-token.mjs`, `revoke-github-token.mjs` |
| `test/` | `node:test` unit tests |
| `examples/` | Consumer pipelines and config |
| `docs/` | Research, guides, reference, design, ADRs (see `docs/README.md`) |

## Commands

```sh
npm ci          # install the pinned release-please
npm test        # unit tests (must pass)
task check      # tests + yamllint
RP_TOKEN=$(gh auth token) RP_REPO_URL=owner/repo RP_DRY_RUN=true node scripts/release-please-run.mjs  # read-only smoke test
```

## Rules

- **Commits.** Use Conventional Commits, DCO-signed (`git commit -s`) as `Shawn Stratton <shawn@skaphos.io>`.
- **Do not create repos or org settings directly.** Change `skaphos/github-state` and let Terraform Cloud apply it.
- **Compatibility surfaces.** The template parameters and the output names in `docs/reference/templates.md` are compatibility surfaces. Changing them is a breaking change (`feat!:`).
- **Pin exactly.** Keep `release-please` pinned to an exact version. On upgrade:
  1. Re-run the tests.
  2. Run a dry-run smoke test.
  3. Re-check `computeOutputs` against upstream `release-please-action/src/index.ts`.
- **No dependencies in the helpers.** The token scripts must stay dependency-free, because they must run before `npm ci` on locked-down agents.
- **Tag claims.** Mark unverified platform behavior as `[U]` in docs. Do not state it as fact.
