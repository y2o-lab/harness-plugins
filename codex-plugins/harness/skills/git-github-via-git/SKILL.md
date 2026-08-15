---
name: git-github-via-git
description: Commit, fetch, pull, merge, rebase, and push repository changes using Git commands only. Use whenever the user asks to commit, push, pull, sync, publish a branch, or otherwise interact with a GitHub-hosted remote through repository operations.
---

# Git-only remote workflow

Use `git` for all repository and remote operations. Do not invoke `gh`, GitHub apps, browser automation, or GitHub REST/GraphQL APIs.

## Commit and push

1. Inspect `git status -sb`, the diff, current branch, and remotes.
2. Identify unrelated changes before staging. Stage explicit paths when the worktree is mixed; otherwise stage the confirmed scope.
3. Run the relevant checks before committing when they have not already passed.
4. Commit with a concise message that describes the complete change.
5. Push with `git push -u origin <current-branch>`.
6. Report the commit SHA, branch, push result, and checks.

## Safety rules

- Never use `git reset --hard`, force-push, or discard user changes unless the user explicitly requests it.
- Never rewrite history on a shared branch without explicit approval.
- If authentication or the remote rejects a push, report the exact Git error and request the smallest needed user action. Do not fall back to another GitHub integration.
- Do not create or modify pull requests, issues, comments, releases, or settings. Those are GitHub product operations, not operations supported by the Git protocol; ask the user for a separate authorized workflow if needed.
