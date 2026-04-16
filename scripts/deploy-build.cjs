const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

try {
  require("dotenv").config();
} catch {
  // Ignore missing dotenv and rely on the deployment environment.
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function main() {
  const root = process.cwd();
  const migrationsDir = path.join(root, "prisma", "migrations");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!existsSync(migrationsDir)) {
    throw new Error("Missing prisma/migrations directory. Commit your migrations before deploying.");
  }

  console.log("Running Prisma generate...");
  run("npx", ["prisma", "generate"]);

  console.log("Running Prisma migrations...");
  try {
    run("npx", ["prisma", "migrate", "deploy"]);
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }

  console.log("Running TypeScript build...");
  run("npx", ["tsc", "--noEmit"]);
}

main();
