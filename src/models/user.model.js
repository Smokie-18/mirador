// backend/src/models/user.model.js
import bcrypt from 'bcrypt';
import { query } from '../config/db.js';

const SALT_ROUNDS = 10; // high enough to be secure, low enough to be fast

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

/**
 * Register a new user with email + password.
 * Hashes the password before storing — raw password never touches the DB.
 * Returns user WITHOUT password_hash (never expose it).
 */
export const registerUser = async ({ name, email, password }) => {
  // Check if email already taken (could be an OAuth account)
  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.auth_provider === 'google') {
      throw new Error('This email is linked to a Google account. Please sign in with Google.');
    }
    throw new Error('Email already registered. Please log in.');
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const sql = `
    INSERT INTO users (name, email, password_hash, auth_provider)
    VALUES ($1, $2, $3, 'local')
    RETURNING id, name, email, avatar_url, role, auth_provider, created_at
  `;
  const { rows } = await query(sql, [name, email, password_hash]);
  return rows[0]; // password_hash intentionally excluded from RETURNING
};

/**
 * Upsert a user from Google OAuth.
 * If google_id already exists → update name + avatar and return the row.
 * If not → insert a new guest user with auth_provider = 'google'.
 * Safe to call on every OAuth login.
 */
export const upsertGoogleUser = async ({ google_id, name, email, avatar_url }) => {
  const sql = `
    INSERT INTO users (google_id, name, email, avatar_url, auth_provider)
    VALUES ($1, $2, $3, $4, 'google')
    ON CONFLICT (google_id)
      DO UPDATE SET
        name       = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url
    RETURNING id, google_id, name, email, avatar_url, role, auth_provider, created_at
  `;
  const { rows } = await query(sql, [google_id, name, email, avatar_url]);
  return rows[0];
};

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

/**
 * Find a user by their internal UUID.
 * Used by passport deserializeUser + auth middleware.
 * password_hash intentionally excluded.
 */
export const findUserById = async (id) => {
  const sql = `
    SELECT id, name, email, avatar_url, role, auth_provider, created_at
    FROM   users
    WHERE  id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Find a user by Google ID.
 * Called during Passport Google strategy.
 */
export const findUserByGoogleId = async (google_id) => {
  const sql = `
    SELECT id, google_id, name, email, avatar_url, role, auth_provider, created_at
    FROM   users
    WHERE  google_id = $1
  `;
  const { rows } = await query(sql, [google_id]);
  return rows[0] ?? null;
};

/**
 * Find a user by email — WITHOUT password_hash.
 * Used for admin lookups and duplicate checks.
 */
export const findUserByEmail = async (email) => {
  const sql = `
    SELECT id, name, email, avatar_url, role, auth_provider, created_at
    FROM   users
    WHERE  email = $1
  `;
  const { rows } = await query(sql, [email]);
  return rows[0] ?? null;
};

/**
 * Find user WITH password_hash — ONLY for local login verification.
 * This is the only function that fetches password_hash.
 * Never use this anywhere else.
 */
export const findUserWithPasswordByEmail = async (email) => {
  const sql = `
    SELECT id, name, email, password_hash, role, auth_provider, created_at
    FROM   users
    WHERE  email         = $1
      AND  auth_provider = 'local'    -- OAuth users have no password — reject early
  `;
  const { rows } = await query(sql, [email]);
  return rows[0] ?? null;
};

/**
 * Verify a plain password against the stored hash.
 * Returns true/false — bcrypt timing-safe comparison.
 */
export const verifyPassword = async (plainPassword, hash) => {
  return bcrypt.compare(plainPassword, hash);
};

// ─────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────

/**
 * Update a user's role.
 * Used by admin to promote guest → host or host → admin.
 */
export const updateUserRole = async (id, role) => {
  const sql = `
    UPDATE users
    SET    role = $1
    WHERE  id   = $2
    RETURNING id, name, email, role
  `;
  const { rows } = await query(sql, [role, id]);
  return rows[0] ?? null;
};
