# MASTER PROMPT — Port ONLY specific files/folders from the original repo into my fork

> Paste into Claude Code, run it inside your fork's local clone (the repo with all your recent work). It brings in only the files/folders you list from the other repo/branch — **it never merges the rest of that old codebase**.

## FILL THIS IN FIRST
```
SOURCE_REPO_URL   = <https URL of the repo that CONTAINS the new features>   # the original/upstream repo (or your fork, if the features live in another branch of it)
SOURCE_BRANCH     = <branch in that repo that has the new features, e.g. main>
# The paths (files or folders) that make up the feature(s) to bring — one per line, repo-relative:
PATHS:
  - <e.g. src/components/SomeNewThing.tsx>
  - <e.g. src/app/api/new-feature/route.ts>
  - <e.g. src/lib/newFeatureHelper.ts>
```
(If SOURCE_REPO_URL is left blank, auto-detect it: this repo is a fork, so `gh repo view --json parent` gives the parent/original repo — use that as the source.)

## MISSION
Bring **only** the files/folders listed in `PATHS` from `SOURCE_BRANCH` into my current branch. Ignore every other change in the source — the source is an **older** codebase and I do **not** want its other files. Do **not** run `git merge`/`git rebase` against the source. Work on a new branch and open a PR; never force-push, never touch files I didn't list except the minimal supporting changes those files genuinely need to compile.

## STEPS

### 1. Safety first
- `cd` to the repo root. Run `git status` — the working tree must be **clean** and I must be on my **up-to-date** branch (the one with all my recent work). If it's dirty, stop and tell me.
- Note my current branch as `TARGET_BRANCH`. Create a **backup**: `git branch backup/pre-port-$(date +%s)`.
- Create and switch to a working branch: `git switch -c port/selected-features`.

### 2. Add the source and fetch it (no merge)
- `git remote add featuresrc <SOURCE_REPO_URL>` (or reuse the fork parent if the URL was blank; if a remote already points there, reuse it). 
- `git fetch featuresrc <SOURCE_BRANCH>`.
- Sanity check the source has the paths: `git ls-tree -r --name-only featuresrc/<SOURCE_BRANCH> -- <each PATH>`. Report any listed path that doesn't exist in the source and skip it.

### 3. Bring each path — but protect my newer files
For **each** path in `PATHS`, decide per file:
- **File/folder does NOT exist on my `TARGET_BRANCH`** (brand-new) → safe to take directly: `git checkout featuresrc/<SOURCE_BRANCH> -- <path>`.
- **File already exists in my repo** (I may have a newer version) → do **NOT** overwrite blindly, because the source is older and would regress my work. Instead:
  - Show me the diff: `git diff my-version..source-version` for that file (`git diff HEAD:<path> featuresrc/<SOURCE_BRANCH>:<path>`).
  - **Merge only the feature-relevant additions** from the source into my current version, keeping all of my newer code. If the change is large or you're unsure what's "the feature" vs "old code," pause and show me the diff rather than guessing.
- For a folder path, apply the same per-file rule to every file under it.

### 4. Make the ported files actually work (minimal supporting changes only)
The listed files may depend on things that exist in the source but not in my repo. Bring in the **minimum** needed for them to compile and run, and **list everything extra you add**:
- **npm dependencies:** if a ported file imports a package not in my `package.json`, add it (`npm i <pkg>` at a compatible version) — do not copy the source's whole `package.json`.
- **Prisma schema:** if a ported file references a model/field my `schema.prisma` lacks, add just that model/field, then `npx prisma generate` (and note that a `db push` is needed). Do not replace my schema.
- **Env vars:** if it needs a new env var, add a placeholder line to `.env.example` (or note it) — never invent secret values.
- **Shared helpers/types:** if a ported file imports a helper that's also new, treat that helper as an additional path to bring (same new-vs-existing rule).
- Fix import paths/aliases so they resolve in my project structure.

### 5. Verify (must pass before you say done)
- `git diff --stat <TARGET_BRANCH>..HEAD` — confirm the changed files are **only** the paths I listed plus the minimal supporting edits from step 4. If anything else changed, revert it.
- `npx tsc --noEmit` and `npm run build` must pass. Fix breakages caused by the port (missing imports, type mismatches) — but if a fix would require pulling in more of the old codebase, stop and ask me instead.
- Briefly confirm the feature is wired in (e.g., the new route is reachable / the new component is importable). Don't fake it.

### 6. Hand off
- Commit with a clear message listing exactly which features/paths were ported and any supporting deps/schema/env additions.
- Push the `port/selected-features` branch and open a **PR** into `TARGET_BRANCH` with `gh pr create`, body summarizing what was brought and what was deliberately left out.
- Report: the exact files brought, the new-vs-merged decision for each, every supporting change you added, and anything you skipped or need me to decide.

## GUARDRAILS
- **Never** `git merge`/`rebase` the source branch, and never `git checkout` a path I didn't list.
- **Never** overwrite a file that already exists in my repo without showing me the diff and merging (my newer code wins).
- No force-push; all work on `port/selected-features`; the backup branch stays intact.
- Add only the minimal deps/schema/env the ported files need — no wholesale copying of `package.json`, lockfile, or `schema.prisma` from the old repo.
