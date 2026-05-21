// backend/src/models/review.model.js
import { query, getClient } from '../config/db.js';
import { hasCompletedBookingForHotel } from './booking.model.js';

// ─────────────────────────────────────────────────────────────
// REVIEW ELIGIBILITY — 3-gate check before any write
//
//  Gate 1 → caller must be authenticated          (req.user exists — enforced in middleware)
//  Gate 2 → user must have a confirmed booking    (hasCompletedBookingForHotel)
//  Gate 3 → user must not have reviewed already   (one review per booking, UNIQUE FK in schema)
// ─────────────────────────────────────────────────────────────

/**
 * Check all eligibility rules before creating a review.
 * Returns { eligible: true } or throws a descriptive error.
 *
 * Call this inside a transaction so the check + insert are atomic —
 * no window for a second request to sneak through between the check and write.
 */
const assertReviewEligibility = async (client, user_id, hotel_id, booking_id) => {
  // Gate 2: confirmed booking that has checked out
  const { rows: bookingRows } = await client.query(
    `SELECT id FROM bookings b
     JOIN   rooms r ON r.id = b.room_id
     WHERE  b.id       = $1
       AND  b.user_id  = $2          -- booking must belong to this user
       AND  r.hotel_id = $3          -- booking must be for this hotel
       AND  b.status   = 'confirmed'
       AND  b.check_out <= CURRENT_DATE`,
    [booking_id, user_id, hotel_id]
  );

  if (bookingRows.length === 0) {
    throw new Error(
      'You can only review a hotel after completing a confirmed stay'
    );
  }

  // Gate 3: no existing review for this booking
  const { rows: existingRows } = await client.query(
    `SELECT id FROM reviews WHERE booking_id = $1`,
    [booking_id]
  );

  if (existingRows.length > 0) {
    throw new Error('You have already reviewed this booking');
  }
};

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

/**
 * Create a review inside a transaction.
 *
 * All 3 eligibility gates are checked atomically with the INSERT,
 * so there is no race condition between check and write.
 *
 * The schema trigger (trg_sync_hotel_rating) automatically updates
 * hotels.avg_rating and hotels.total_reviews after the INSERT.
 */
export const createReview = async ({ user_id, hotel_id, booking_id, rating, comment }) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Runs Gates 2 & 3 inside the same transaction
    // Gate 1 (authenticated) is already enforced by auth middleware — req.user exists
    await assertReviewEligibility(client, user_id, hotel_id, booking_id);

    const { rows } = await client.query(
      `INSERT INTO reviews (user_id, hotel_id, booking_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, hotel_id, booking_id, rating, comment]
    );

    await client.query('COMMIT');
    return rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

/**
 * Get paginated reviews for a hotel — most recent first.
 * Includes reviewer name + avatar so the UI doesn't need a second request.
 */
export const findReviewsByHotel = async ({ hotel_id, limit = 10, after_id = null }) => {
  const values = [hotel_id];
  let   cursorClause = '';

  if (after_id) {
    values.push(after_id);
    cursorClause = `AND r.id < $${values.length}`;
  }

  values.push(limit + 1);
  const sql = `
    SELECT
      r.id, r.rating, r.comment, r.created_at,
      u.id         AS user_id,
      u.name       AS user_name,
      u.avatar_url AS user_avatar
    FROM   reviews r
    JOIN   users   u ON u.id = r.user_id
    WHERE  r.hotel_id = $1
      ${cursorClause}
    ORDER  BY r.created_at DESC, r.id DESC
    LIMIT  $${values.length}
  `;

  const { rows } = await query(sql, values);

  const hasNextPage = rows.length > limit;
  const reviews     = hasNextPage ? rows.slice(0, limit) : rows;
  const nextCursor  = hasNextPage ? reviews[reviews.length - 1].id : null;

  return { reviews, nextCursor, hasNextPage };
};

/**
 * Get all reviews written by a user (for their profile/dashboard).
 */
export const findReviewsByUser = async (user_id) => {
  const sql = `
    SELECT
      r.id, r.rating, r.comment, r.created_at,
      h.id   AS hotel_id,
      h.name AS hotel_name,
      h.city AS hotel_city
    FROM   reviews r
    JOIN   hotels  h ON h.id = r.hotel_id
    WHERE  r.user_id = $1
    ORDER  BY r.created_at DESC
  `;
  const { rows } = await query(sql, [user_id]);
  return rows;
};

/**
 * Get a single review by ID.
 */
export const findReviewById = async (id) => {
  const sql = `
    SELECT id, user_id, hotel_id, booking_id, rating, comment, created_at
    FROM   reviews
    WHERE  id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────

/**
 * Delete a review by ID.
 * Controller must verify ownership (review.user_id === req.user.id) before calling.
 * Schema trigger automatically recalculates hotel avg_rating after DELETE.
 */
export const deleteReview = async (id) => {
  const sql = `
    DELETE FROM reviews
    WHERE  id = $1
    RETURNING id, hotel_id, rating
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// HELPER FOR CONTROLLER
// ─────────────────────────────────────────────

/**
 * Verify that a review belongs to a specific user.
 * Used by controller before allowing delete.
 */
export const isReviewOwner = async (review_id, user_id) => {
  const sql = `
    SELECT EXISTS (
      SELECT 1 FROM reviews
      WHERE  id      = $1
        AND  user_id = $2
    ) AS is_owner
  `;
  const { rows } = await query(sql, [review_id, user_id]);
  return rows[0].is_owner;
};
