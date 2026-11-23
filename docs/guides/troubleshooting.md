# Troubleshooting

## "There are untagged, merged release PRs outstanding - aborting"

A merged release PR still carries `autorelease: pending`. Release-please refuses to open the next PR until that release is tagged. [V] `manifest.js`

- **`releaseMode: github-release` or `tag-only`.** The next run tags the PR and relabels it. If that keeps failing, read the release phase log; the usual cause is a missing *Contents: write* permission or a tag ruleset.
- **`releaseMode: none`, or a release made by hand.** Swap the label yourself: `gh pr edit N --remove-label "autorelease: pending" --add-label "autorelease: tagged"`.

## `404` / `Not Found` from the token minter

- **The App isn't installed** on that repository, or `owner`/`repository` is wrong.
- **GHES:** `apiUrl` must be `https://HOST/api/v3`, not the bare host.
- **Wrong issuer:** `appId` must be the App ID or the Client ID, not the installation ID.

## `error:1E08010C:DECODER routines::unsupported` / invalid PEM

The private key variable is empty or mangled. The minter repairs flattened newlines (`\n` or spaces), but two causes it can't fix:

- **Unmapped secret variable.** Is `privateKeyVariable` the *name* of the variable (no `$( )`)?
- **Inaccessible variable group.** Is the group linked to the pipeline and allowed in *Pipeline permissions*?

## GraphQL errors on GHES (`Not Found` on `/graphql`)

Set `graphqlUrl: https://HOST/api`. Octokit appends `/graphql` itself, so do not include it.

## Changelog links point at github.com on GHES

Add `"changelog-host": "https://HOST"` to `release-please-config.json` (googleapis/release-please#2351).

## Requests hang or time out behind a proxy

- Check that `HTTPS_PROXY` and `NO_PROXY` are pipeline variables or set on the agent. The templates already set `NODE_USE_ENV_PROXY=1`.
- If you pinned an older Node 22, upgrade it: `NODE_USE_ENV_PROXY` needs a recent Node.
- With a TLS-intercepting proxy, set `NODE_EXTRA_CA_CERTS`.

## Output variables are empty in a later stage

- **Wrong reference shape.** Across stages use `stageDependencies.<stage>.<job>.outputs['<step>.<name>']`. In a stage `condition` use `dependencies.<stage>.outputs['<job>.<step>.<name>']`.
- **Name sanitizing.** Non-root package outputs replace `/` and `-` with `_`, and `--` with `__`.
- **No release this run.** `release_created` is only set when a release happened, as in the action. Compare `releases_created` to `'true'`, which is always set.

## The release PR never gets CI

- **Branch filter.** Your PR pipeline must include `release-please--*` source branches, or use the default of all branches.
- **Token type.** PRs from an App token trigger webhooks normally. If you swapped in Actions' `GITHUB_TOKEN`-style credentials, they won't.

## `npm ci` fails on the agent

- **Blocked public npm.** Set `npmRegistry` to your Azure Artifacts feed with an npmjs upstream.
- **Feed permissions.** The build identity needs *Feed and Upstream Reader* to pull through the upstream.
