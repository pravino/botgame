import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";

export async function runMigrations() {
  const connectionString = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("No database connection string found");
  }

  const isProduction = process.env.NODE_ENV === "production";
  const migrationPool = new pg.Pool({ connectionString });
  const migrationDb = drizzle(migrationPool);
  const migrationsPath = path.resolve(process.cwd(), "migrations");

  console.log(`Running database migrations from ${migrationsPath}...`);

  try {
    await migrate(migrationDb, { migrationsFolder: migrationsPath });
    console.log("Database migrations completed successfully");
  } catch (err: any) {
    if (err?.code === "42P07" && !isProduction) {
      console.log("Dev DB: tables already exist, syncing migration journal...");
      await syncJournal(migrationPool, migrationsPath);
      console.log("Migration journal synced — future migrations will apply normally");
    } else {
      await migrationPool.end();
      throw err;
    }
  }

  await migrationPool.end();
}

async function syncJournal(pool: pg.Pool, migrationsPath: string) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const fs = await import("fs");
  const journalPath = path.join(migrationsPath, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));

  for (const entry of journal.entries) {
    const exists = await pool.query(
      `SELECT 1 FROM "__drizzle_migrations" WHERE hash = $1`,
      [entry.tag]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [entry.tag, entry.when ?? Date.now()]
      );
    }
  }
}
