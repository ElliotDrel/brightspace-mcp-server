# Maintaining the Purdue fork

## Production

This folder is the production checkout. Its `main` branch tracks `fork/main` (ElliotDrel/brightspace-mcp-server). Purdue Codex and Claude Code configurations launch this folder's `build/index.js`. Changing branch names alone does not require a rebuild or restart.

The sibling primary checkout (`brightspace-mcp-server`) is an upstream reference on `upstream-main`, tracking `origin/main` (RohanMuppa/brightspace-mcp-server). Both folders share Git branches and remotes. In this repository, `origin` is Rohan and `fork` is Elliot: push production to `fork`, not `origin`.

## Development and deployment

For larger changes, create a sibling worktree on a `codex/` feature branch starting from production `main`. Implement, build and test there, then merge into `main` in this production folder. Small changes may be made directly on production `main`, as Elliot prefers. Check for unrelated local changes before either workflow.

Before deployment, record the last working commit and preserve a copy of the working build if changing it. Run the build and relevant tests, push finished changes to `fork/main`, then restart the consuming MCP connections. Git commits do not automatically rebuild or reload running processes. Verify the server version and a real read-only course call after deployment. Fresh-login verification is warranted for authentication changes, not routine updates: it can send phone notifications.

## Upstream updates

Fetch `origin/main` and review its changes. Merge it into a development worktree based on production `main`; resolve conflicts while preserving automatic TOTP, native credential storage and logging. Build and test the combined result before merging into production. Fast-forward the upstream reference checkout separately with `git merge --ff-only origin/main` when it is clean. Never reset production to upstream, because that would remove fork additions.

Updates are deliberate. The deleted weekly updater stays deleted. The daily observer collects non-secret logs and does not upgrade or authenticate.

## Rollback

Keep a known working commit and build before deployment. Prefer reverting the faulty change on `main`, rebuilding, testing and pushing normally; do not force-push. Historical branches `codex/upstream-totp` and `codex/purdue-totp` remain preserved. Never delete backup files without Elliot's explicit per-file authorization.
