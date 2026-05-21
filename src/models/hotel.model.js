// backend/src/models/hotel.model.js
import { query } from '../config/db.js';

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

/**
 * Create a new hotel. owner_id comes from req.user (authenticated host).
 */
export const createHotel = async ({ owner_id, name, description, city, country, latitude, longitude, price_per_night }) => {
  const sql = `
    INSERT INTO hotels (owner_id, name, description, city, country, latitude, longitude, price_per_night)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    owner_id, name, description, city, country, latitude, longitude, price_per_night,
  ]);
  return rows[0];
};

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

/**
 * Search hotels by city with optional filters.
 *
 * Scalability:
 *  - Cursor-based pagination (after_id) instead of OFFSET — OFFSET gets slower
 *    as pages grow; cursor stays O(log n) via the index.
 *  - Filters are applied only when provided (no unnecessary WHERE clauses).
 *  - avg_rating and total_reviews are denormalized — no JOIN/subquery needed.
 *  - Returns one extra row to tell the caller if a next page exists.
 */
export const searchHotels = async ({
  city,
  min_price,
  max_price,
  min_rating,
  limit = 20,
  after_id         = null,   // cursor: UUID of the last hotel from the previous page
  after_created_at = null,   // cursor: created_at of the last hotel from the previous page
}) => {
  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (city) {
    conditions.push(`LOWER(city) = LOWER($${idx++})`);
    values.push(city);
  }
  if (min_price != null) {
    conditions.push(`price_per_night >= $${idx++}`);
    values.push(min_price);
  }
  if (max_price != null) {
    conditions.push(`price_per_night <= $${idx++}`);
    values.push(max_price);
  }
  if (min_rating != null) {
    conditions.push(`avg_rating >= $${idx++}`);
    values.push(min_rating);
  }
  // Cursor condition — row-value comparison so ORDER BY (created_at, id) is stable.
  // gen_random_uuid() UUIDs are not sequential, so id-only cursors skip/repeat rows.
  if (after_created_at && after_id) {
    conditions.push(`(h.created_at, h.id) > ($${idx++}::timestamptz, $${idx++}::uuid)`);
    values.push(after_created_at, after_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Fetch limit + 1 to determine if there's a next page without a COUNT query
  values.push(limit + 1);
  const sql = `
    SELECT
      h.id, h.owner_id, h.name, h.description,
      h.city, h.country, h.latitude, h.longitude,
      h.price_per_night, h.avg_rating, h.total_reviews, h.created_at,
      -- primary image in same query, no second round-trip
      (SELECT image_url FROM hotel_images WHERE hotel_id = h.id AND is_primary = TRUE LIMIT 1) AS primary_image
    FROM hotels h
    ${where}
    ORDER BY h.created_at ASC, h.id ASC
    LIMIT $${idx}
  `;

  const { rows } = await query(sql, values);

  const hasNextPage = rows.length > limit;
  const hotels      = hasNextPage ? rows.slice(0, limit) : rows;
  const lastHotel   = hotels[hotels.length - 1];
  const nextCursor  = hasNextPage
    ? { id: lastHotel.id, created_at: lastHotel.created_at }
    : null;

  return { hotels, nextCursor, hasNextPage };
};

/**
 * Get full hotel detail by ID — includes rooms and all images.
 * Single DB round-trip using JSON aggregation.
 */
export const findHotelById = async (id) => {
  const sql = `
    SELECT
      h.id, h.owner_id, h.name, h.description,
      h.city, h.country, h.latitude, h.longitude,
      h.price_per_night, h.avg_rating, h.total_reviews, h.created_at,

      -- Aggregate images into a JSON array
      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'id',         hi.id,
            'image_url',  hi.image_url,
            'is_primary', hi.is_primary
          )
        ) FILTER (WHERE hi.id IS NOT NULL),
        '[]'
      ) AS images,

      -- Aggregate rooms into a JSON array
      COALESCE(
        JSON_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'id',              r.id,
            'room_type',       r.room_type,
            'capacity',        r.capacity,
            'price_per_night', r.price_per_night,
            'is_available',    r.is_available
          )
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'
      ) AS rooms

    FROM   hotels    h
    LEFT JOIN hotel_images hi ON hi.hotel_id = h.id
    LEFT JOIN rooms        r  ON r.hotel_id  = h.id
    WHERE  h.id = $1
    GROUP  BY h.id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Get all hotels owned by a specific host.
 */
export const findHotelsByOwner = async (owner_id) => {
  const sql = `
    SELECT
      h.id, h.name, h.city, h.country,
      h.price_per_night, h.avg_rating, h.total_reviews, h.created_at,
      (SELECT image_url FROM hotel_images WHERE hotel_id = h.id AND is_primary = TRUE LIMIT 1) AS primary_image
    FROM   hotels h
    WHERE  h.owner_id = $1
    ORDER  BY h.created_at DESC
  `;
  const { rows } = await query(sql, [owner_id]);
  return rows;
};

// ─────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────

/**
 * Update hotel details. Only updates fields that are actually provided.
 * Dynamic SET build avoids overwriting untouched fields with nulls.
 */
export const updateHotel = async (id, fields) => {
  const allowed = ['name', 'description', 'city', 'country', 'latitude', 'longitude', 'price_per_night'];
  const updates = [];
  const values  = [];
  let   idx     = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }

  if (updates.length === 0) return null; // nothing to update

  values.push(id);
  const sql = `
    UPDATE hotels
    SET    ${updates.join(', ')}
    WHERE  id = $${idx}
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────

/**
 * Delete a hotel by ID.
 * Cascades to rooms, hotel_images, reviews (defined in schema FK constraints).
 */
export const deleteHotel = async (id) => {
  const sql = `
    DELETE FROM hotels
    WHERE  id = $1
    RETURNING id, name
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// HOTEL IMAGES
// ─────────────────────────────────────────────

/**
 * Add an image to a hotel. If is_primary is true, unset all other primary images first.
 * Wrapped in a transaction to keep primary flag consistent.
 */
export const addHotelImage = async (hotel_id, image_url, is_primary = false) => {
  const { getClient } = await import('../config/db.js');
  const client = await getClient();

  try {
    await client.query('BEGIN');

    if (is_primary) {
      await client.query(
        `UPDATE hotel_images SET is_primary = FALSE WHERE hotel_id = $1`,
        [hotel_id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO hotel_images (hotel_id, image_url, is_primary)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [hotel_id, image_url, is_primary]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // always return client to pool
  }
};

/**
 * Delete an image by ID.
 */
export const deleteHotelImage = async (image_id) => {
  const sql = `DELETE FROM hotel_images WHERE id = $1 RETURNING id`;
  const { rows } = await query(sql, [image_id]);
  return rows[0] ?? null;
};
