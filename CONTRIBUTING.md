# Contributing to OakBun

## Release Process

OakBun uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

### For every feature or fix:

1. Implement your change
2. Run `bun changeset` and follow the prompts:
   - Which packages are affected?
   - `patch` (bug fix) / `minor` (new feature) / `major` (breaking change)?
   - Write a short description for the CHANGELOG
3. Commit the generated `.changeset/*.md` file together with your code
4. Open a PR and merge to `main`

### What happens automatically:

- The Gitea Action detects pending changesets on `main`
- It creates a "Version Packages" PR that bumps versions and updates CHANGELOGs
- Merging that PR triggers `changeset publish`, which publishes all changed packages to npm

### Manual release (if needed):

```bash
bun run build       # compile all packages
bun changeset       # create a changeset
bun run version     # apply version bumps
bun run release     # build + publish to npm
```

## Local Development

```bash
bun install             # install all dependencies
bun run build           # build all packages
bun test                # run tests
bun run typecheck       # typecheck all packages
```
