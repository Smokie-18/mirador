// backend/src/config/db.js
import pkg    from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pkg;

types.setTypeParser(1082, (val) => val);

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
        min: 0,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      }
    : {
        user:     process.env.DB_USER,
        host:     process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port:     Number(process.env.DB_PORT) || 5432,
        max: 20,
        min: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

pool.on('connect', (client) => {
  console.log(`[DB] New client connected — pool size: ${pool.totalCount}`);
});

pool.on('error', (err, client) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
  // process.exit removed — Neon free tier idle timeouts pe crash nahi karega
});

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;