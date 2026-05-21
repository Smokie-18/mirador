// backend/src/config/db.js
import pkg    from 'pg';
import dotenv from 'dotenv';

// Load .env before creating the Pool.
// ESM static imports are hoisted, so dotenv in app.js runs AFTER this module
// is evaluated — we must load it here to guarantee env vars are available.
dotenv.config();

const { Pool, types } = pkg;

// Return DATE columns as 'YYYY-MM-DD' strings, not JS Date objects.
// JS Date's timezone handling would corrupt dates for users in non-UTC zones.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     Number(process.env.DB_PORT) || 5432,

  // --- scalability knobs ---
  max:                20,   // max connections in pool (tune per server RAM)
  min:                2,    // keep 2 warm so first requests don't cold-start
  idleTimeoutMillis:  30000, // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB is unreachable
});

pool.on('connect', (client) => {
  console.log(`[DB] New client connected — pool size: ${pool.totalCount}`);
});

pool.on('error', (err, client) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
  process.exit(-1);
});

// Lightweight query helper — always releases the client back to pool
export const query = (text, params) => pool.query(text, params);

// For transactions: caller gets a client, runs queries, then MUST call client.release()
export const getClient = () => pool.connect();

export default pool;