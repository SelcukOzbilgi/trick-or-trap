---
inclusion: always
---

# Workflow: specs, branches and pull requests

- One spec = one branch = one pull request. The branch is named `<type>/<spec-name>`, for example `feat/page-capture`; the type is one of feat, fix, docs, chore, ci, test.
- The spec's own `docs: add <name> spec` commit goes first on the branch, so the pull request shows the spec before the code. It does not go to `main` ahead of the code.
- One commit per task in `tasks.md`, titled `<type>: <description>` in lowercase plain English. No attribution trailers.
- The pull request title is the commit-style summary. Its body follows `.github/pull_request_template.md`: it links the spec folder, copies the task checklist, gives the checks and says who wrote what.
- Pull requests are merged with a merge commit, never squashed or rebased. The owner merges; the branch is deleted on merge.
- Issues: one per remaining spec (label `spec`) plus real defects (label `bug`). Reference an issue with `Refs #N`, and close it with `Closes #N` only in the pull request that finishes it.
- Security reports never go in a public issue; they use private vulnerability reporting (see `SECURITY.md`).
- Files under `.github/`, `.githooks/`, `.kiro/hooks/`, `.kiro/agents/`, `.gitleaks.toml` and `SECURITY.md` are not written by Kiro; the driver writes them and says so in the commit body.
