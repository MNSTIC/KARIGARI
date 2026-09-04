// Prisma 7 CLI config. `definePrismaConfig`/`datasource.url` are Prisma 8-RC
// API — this project is pinned to the 7.x line (see PRISMA_VERSION_FIX.md).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
