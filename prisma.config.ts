// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config } = require("dotenv");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { existsSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolve } = require("node:path");

const cwd = process.cwd();
const envPath = process.env.PRISMA_ENV_FILE
  ? resolve(cwd, process.env.PRISMA_ENV_FILE)
  : existsSync(resolve(cwd, ".env.development")) && process.env.NODE_ENV !== "production"
  ? resolve(cwd, ".env.development")
  : resolve(cwd, ".env");

config({ path: envPath });

module.exports = {};
