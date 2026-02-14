import 'dotenv/config';

/** @type {import('drizzle-kit').Config} */
export default {
  schema: './src/db/schema/index.mjs',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
};
