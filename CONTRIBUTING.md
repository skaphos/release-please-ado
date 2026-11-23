# Contributing

- **Branches and PRs.** Branch from `main` and open a PR. Changes land through PRs only.
- **Commits.** Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`), and DCO-sign every commit (`git commit -s`). CI rejects commits without a `Signed-off-by` trailer.
- **Validate locally** before pushing:

  ```sh
  npm ci
  task check     # npm test + yamllint --strict
  ```

- **Compatibility surface.** Template parameters and output names ([docs/reference/templates.md](docs/reference/templates.md)) are the public contract. Breaking them requires `feat!:` and a migration note.
- **Upgrading release-please:**
  1. Bump the exact pin in `package.json` and run `npm install`.
  2. Run `npm test`.
  3. Run `task smoke REPO=<a repo with release-please config>`.
  4. Diff upstream `release-please-action/src/index.ts` against `computeOutputs()`.
- **Platform claims.** Behavior you have not verified in a real Azure DevOps org is marked `[U]` in docs.
