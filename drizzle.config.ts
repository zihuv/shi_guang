import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./electron/database/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SHIGUANG_DB_FILE ?? "./.drizzle/shiguang.db",
  },
  migrations: {
    table: "__drizzle_migrations__",
  },
  strict: true,
  verbose: true,
});
