# Releasing

This repository lives on github.com and releases itself with `googleapis/release-please-action`, using `.github/workflows/release-please.yml`.

1. Every push to `main` opens or updates the `chore(main): release X.Y.Z` PR.
2. Merging that PR creates the `vX.Y.Z` tag and the GitHub Release.
3. Consumers pin `resources.repositories[].ref: refs/tags/vX.Y.Z`.

Credentials:

- **The release bot.** Releases use the org GitHub App `skaphos-release-bot`, configured as `vars.RELEASE_BOT_CLIENT_ID` and `secrets.RELEASE_BOT_PRIVATE_KEY` at org level. The workflow mints a repo-scoped token per run.
- **No PATs.** Do not add long-lived PATs.

Versioning:

- **Breaking changes** are any change to template parameters or output names. They need `feat!:`, which means a minor bump while the version is pre-1.0.
- **Before 1.0.0,** the validation checklist in [docs/research.md](docs/research.md#validation-checklist) must be complete.
