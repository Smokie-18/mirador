// backend/db/migrate.js
// Run: npm run migrate
// Creates all tables, indexes, and triggers from scratch.
// Safe to re-run — every statement uses IF NOT EXISTS.

import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     Number(process.env.DB_PORT) || 5432,
});

// ─────────────────────────────────────────────
// MIGRATION STEPS — order matters (FK dependencies)
// ─────────────────────────────────────────────

const migrations = [

  {
    name: 'Enable btree_gist extension',
    sql: `CREATE EXTENSION IF NOT EXISTS btree_gist;`,
  },

  // ── 1. USERS ──────────────────────────────
  {
    name: 'Create users table',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        google_id     TEXT        UNIQUE,
        name          TEXT        NOT NULL,
        email         TEXT        UNIQUE NOT NULL,
        avatar_url    TEXT,
        password_hash TEXT,
        role          TEXT        NOT NULL DEFAULT 'guest'
                        CHECK (role IN ('guest', 'host', 'admin')),
        auth_provider TEXT        NOT NULL DEFAULT 'local'
                        CHECK (auth_provider IN ('local', 'google')),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },

  // ── 2. HOTELS ─────────────────────────────
  {
    name: 'Create hotels table',
    sql: `
      CREATE TABLE IF NOT EXISTS hotels (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT          NOT NULL,
        description     TEXT,
        city            TEXT          NOT NULL,
        country         TEXT          NOT NULL,
        latitude        NUMERIC(9,6),
        longitude       NUMERIC(9,6),
        price_per_night NUMERIC(10,2) NOT NULL CHECK (price_per_night > 0),
        avg_rating      NUMERIC(3,2)  NOT NULL DEFAULT 0
                          CHECK (avg_rating >= 0 AND avg_rating <= 5),
        total_reviews   INT           NOT NULL DEFAULT 0 CHECK (total_reviews >= 0),
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: 'Create hotels indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_hotels_city       ON hotels(city);
      CREATE INDEX IF NOT EXISTS idx_hotels_country    ON hotels(country);
      CREATE INDEX IF NOT EXISTS idx_hotels_owner      ON hotels(owner_id);
      CREATE INDEX IF NOT EXISTS idx_hotels_price      ON hotels(price_per_night);
      CREATE INDEX IF NOT EXISTS idx_hotels_avg_rating ON hotels(avg_rating DESC);
      CREATE INDEX IF NOT EXISTS idx_hotels_city_price ON hotels(city, price_per_night);
    `,
  },

  // ── 3. ROOMS ──────────────────────────────
  {
    name: 'Create rooms table',
    sql: `
      CREATE TABLE IF NOT EXISTS rooms (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        hotel_id        UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        room_type       TEXT          NOT NULL
                          CHECK (room_type IN ('single', 'double', 'suite')),
        capacity        SMALLINT      NOT NULL CHECK (capacity > 0),
        price_per_night NUMERIC(10,2) NOT NULL CHECK (price_per_night > 0),
        is_available    BOOLEAN       NOT NULL DEFAULT TRUE
      );
    `,
  },
  {
    name: 'Create rooms indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_rooms_hotel     ON rooms(hotel_id);
      CREATE INDEX IF NOT EXISTS idx_rooms_available ON rooms(hotel_id, is_available);
    `,
  },

  // ── 4. BOOKINGS ───────────────────────────
  {
    name: 'Create bookings table',
    sql: `
      CREATE TABLE IF NOT EXISTS bookings (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID          NOT NULL REFERENCES users(id),
        room_id     UUID          NOT NULL REFERENCES rooms(id),
        check_in    DATE          NOT NULL,
        check_out   DATE          NOT NULL,
        total_price NUMERIC(10,2) NOT NULL CHECK (total_price > 0),
        status      TEXT          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'cancelled')),
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

        CONSTRAINT check_out_after_check_in CHECK (check_out > check_in),

        -- Prevents double-booking at DB level (Layer 3 of concurrency guard)
        CONSTRAINT no_overlap EXCLUDE USING gist (
          room_id WITH =,
          daterange(check_in, check_out, '[)') WITH &&
        ) WHERE (status <> 'cancelled')
      );
    `,
  },
  {
    name: 'Create bookings indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_bookings_user   ON bookings(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_room   ON bookings(room_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
      CREATE INDEX IF NOT EXISTS idx_bookings_dates  ON bookings(check_in, check_out);
    `,
  },

  // ── 5. REVIEWS ────────────────────────────
  {
    name: 'Create reviews table',
    sql: `
      CREATE TABLE IF NOT EXISTS reviews (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id),
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        booking_id UUID        NOT NULL UNIQUE REFERENCES bookings(id),
        rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: 'Create reviews indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_reviews_hotel ON reviews(hotel_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_user  ON reviews(user_id);
    `,
  },

  // ── 6. HOTEL IMAGES ───────────────────────
  {
    name: 'Create hotel_images table',
    sql: `
      CREATE TABLE IF NOT EXISTS hotel_images (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        image_url  TEXT        NOT NULL,
        is_primary BOOLEAN     NOT NULL DEFAULT FALSE
      );
    `,
  },
  {
    name: 'Create hotel_images indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_images_hotel ON hotel_images(hotel_id);
    `,
  },

  // ── 4b. ADD GUESTS COLUMN (safe: IF NOT EXISTS) ──────
  {
    name: 'Add guests column to bookings',
    sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guests SMALLINT NOT NULL DEFAULT 1 CHECK (guests > 0);`,
  },

  // ── TRIGGER: auto-sync avg_rating + total_reviews ──
  {
    name: 'Create sync_hotel_rating trigger function',
    sql: `
      CREATE OR REPLACE FUNCTION sync_hotel_rating()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE hotels
        SET
          avg_rating    = COALESCE((
            SELECT ROUND(AVG(rating)::NUMERIC, 2)
            FROM   reviews
            WHERE  hotel_id = COALESCE(NEW.hotel_id, OLD.hotel_id)
          ), 0),
          total_reviews = (
            SELECT COUNT(*)
            FROM   reviews
            WHERE  hotel_id = COALESCE(NEW.hotel_id, OLD.hotel_id)
          )
        WHERE id = COALESCE(NEW.hotel_id, OLD.hotel_id);

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `,
  },
  {
    name: 'Attach sync_hotel_rating trigger to reviews',
    sql: `
      DROP TRIGGER IF EXISTS trg_sync_hotel_rating ON reviews;
      CREATE TRIGGER trg_sync_hotel_rating
      AFTER INSERT OR DELETE ON reviews
      FOR EACH ROW EXECUTE FUNCTION sync_hotel_rating();
    `,
  },

];

// ─────────────────────────────────────────────
// RUNNER
// ─────────────────────────────────────────────

const run = async () => {
  const client = await pool.connect();

  try {
    console.log('\n Starting migration...\n');

    for (const migration of migrations) {
      try {
        await client.query(migration.sql);
        console.log(`    ${migration.name}`);
      } catch (err) {
        console.error(`   ${migration.name}`);
        console.error(`      Error: ${err.message}\n`);
        throw err; // stop on first failure
      }
    }

    console.log('\n Migration complete — all tables ready.\n');
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err) => {
  console.error('\n Migration failed:', err.message);
  process.exit(1);
});
