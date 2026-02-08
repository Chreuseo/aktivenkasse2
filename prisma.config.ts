// eslint-disable-next-line @typescript-eslint/no-var-requires
import {defineConfig, env} from "@prisma/config";

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

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
        seed: 'tsx prisma/seed.ts',
    },
    datasource: {
        url: env("DATABASE_URL")
    }
});

module.exports = {};
