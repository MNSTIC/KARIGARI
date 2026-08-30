# MASTER PROMPT — Fix Prisma P1012 (`url is missing`) — version mismatch after the merge

> Paste into Claude Code. App root: **`KARIGARI-main/KARIGARI/`** (`cd` there). This is a small, precise dependency fix — do exactly this, then verify.

## Root cause (confirmed)
`package.json` has a **version mismatch** introduced when it was resolved as a merge conflict:
- `devDependencies.prisma` = **`^6.12.0`**  ← wrong (the CLI/engine)
- `dependencies["@prisma/client"]` = `^7.9.1` and `dependencies["@prisma/adapter-pg"]` = `^7.9.1`

The schema's datasource is intentionally **url-less**:
```prisma
datasource db { provider = "postgresql" }
```
That is valid in **Prisma 7**, where the connection comes from the driver adapter at runtime (`src/lib/prisma.ts` → `PrismaPg`) and from `prisma.config.ts` (`datasource.url = process.env.DATABASE_URL`) for the CLI. But **Prisma 6.12.0 does not support a url-less datasource**, so it fails validation with `P1012: Argument "url" is missing in data source block "db"`. That makes `@prisma/client` init throw → `POST /api/auth/register` returns 500 → the frontend's `res.json()` throws `Unexpected end of JSON input`.

So the fix is to put the Prisma **CLI back on v7** to match the client — NOT to change the schema.

## The fix (do all steps)
1. In `package.json`, change the `prisma` devDependency to match the client:
   ```json
   "prisma": "^7.9.1"
   ```
   (It must be the same major/minor line as `@prisma/client` and `@prisma/adapter-pg`, which are `^7.9.1`.)
2. Reinstall cleanly so the lockfile/node_modules stop resolving 6.12.0:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
   (If `rm` isn't available on Windows PowerShell, delete `node_modules` and `package-lock.json` and run `npm install`.)
3. Regenerate the client with the now-v7 CLI:
   ```bash
   npx prisma generate
   ```
4. **Restart the dev server** (`npm run dev`) — a server started against the old client keeps the stale/mismatched engine even after regenerating.

## Do NOT
- Do **not** add `url = env("DATABASE_URL")` to the `datasource db` block. The url-less datasource is the correct Prisma 7 + driver-adapter design; `prisma.config.ts` already provides the url to the CLI and `src/lib/prisma.ts` provides it at runtime. Adding it back is unnecessary and muddies the adapter setup.
- Do not downgrade `@prisma/client`/`@prisma/adapter-pg` to 6.x — the app code uses the Prisma 7 adapter API.

## Verify (report results)
- `npx prisma -v` shows **prisma and @prisma/client both on 7.9.x** (not 6.12.0).
- `npm ls prisma @prisma/client @prisma/adapter-pg` shows all three on the 7.9.x line with no "invalid"/mismatch warnings.
- `npx prisma validate` passes (no P1012).
- Register a new user in the running app → `POST /api/auth/register` returns 200 and the account is created (no "Unexpected end of JSON input", no 500).
- `npm run build` succeeds.

If, after this, `npx prisma -v` still shows 6.12.0, check for a **global** Prisma install shadowing the local one (`npm ls -g prisma`) and ensure commands run via the project's `npx prisma` (local binary), not a global `prisma`.
