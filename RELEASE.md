# Release

Releases are published to npm from GitHub Actions using
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no
npm token is stored in the repository. Packages get
[provenance](https://docs.npmjs.com/generating-provenance-statements)
attestations automatically.

1. Bump the version:
   ```sh
   npm version <patch|minor|major> --no-git-tag-version
   ```
2. Commit and push to `master`.
3. [Create a GitHub release](https://github.com/antonmedv/codejar/releases/new)
   with a new tag `X.Y.Z` (no `v` prefix, matching earlier releases).
4. The [`publish`](.github/workflows/publish.yaml) workflow waits for approval
   in the `npm` environment, then builds the package and runs `npm publish`.

## One-time setup

- **npm**: on npmjs.com → `codejar` → Settings → Trusted Publisher, add a GitHub
  Actions publisher with repository `antonmedv/codejar`, workflow
  `publish.yaml` and environment `npm`. Then set publishing access to
  "Require two-factor authentication and disallow tokens".
- **GitHub**: environment `npm` (Settings → Environments) with a required
  reviewer, limited to tags matching `*.*.*`.
- **GitHub Pages**: Settings → Pages → Source: "GitHub Actions". The
  [`pages`](.github/workflows/pages.yaml) workflow deploys the demo on every
  push to `master`.
