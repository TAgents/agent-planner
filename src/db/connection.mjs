import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.mjs';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Connection pool for queries
const queryClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Drizzle instance with schema for relational queries
export const db = drizzle(queryClient, { schema });

// Raw client for migrations or custom SQL
export const sql = queryClient;

// Graceful shutdown
export async function closeConnection() {
  await queryClient.end();
}
