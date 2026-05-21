// backend/src/models/booking.model.js
import { query, getClient } from '../config/db.js';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Calculate total price for a booking.
 * check_in and check_out are DATE strings ('YYYY-MM-DD').
 */
const calcTotalPrice = (price_per_night, check_in, check_out) => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const nights   = Math.round(
    (new Date(check_out) - new Date(check_in)) / msPerDay
  );
  if (nights <= 0) throw new Error('check_out must be after check_in');
  return +(price_per_night * nights).toFixed(2); // round to 2 decimal places
};

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

/**
 * Create a booking inside a transaction.
 *
 * Scalability & correctness:
 *  1. SELECT ... FOR UPDATE locks the room row for the duration of the TX,
 *     preventing two concurrent requests from booking the same room
 *     simultaneously (optimistic concurrency at application layer).
 *  2. The INSERT itself is still guarded by the schema-level
 *     EXCLUDE USING gist constraint — double safety net.
 *  3. total_price is computed here (server-side) — never trust client price.
 *  4. ROLLBACK on any failure ensures no partial state in the DB.
 */
export const createBooking = async ({ user_id, room_id, check_in, check_out, guests = 1 }) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Lock the room row + verify it's still available
    const { rows: roomRows } = await client.query(
      `SELECT id, price_per_night, is_available
       FROM   rooms
       WHERE  id = $1
       FOR UPDATE`,                  // row-level lock held until COMMIT/ROLLBACK
      [room_id]
    );

    const room = roomRows[0];
    if (!room)              throw new Error('Room not found');
    if (!room.is_available) throw new Error('Room is not available for booking');

    // 2. Check for overlapping non-cancelled bookings (app-layer guard)
    const { rows: conflictRows } = await client.query(
      `SELECT id FROM bookings
       WHERE  room_id = $1
         AND  status <> 'cancelled'
         AND  daterange(check_in, check_out, '[)') &&
              daterange($2::date, $3::date, '[)')`,
      [room_id, check_in, check_out]
    );

    if (conflictRows.length > 0) {
      throw new Error('Room is already booked for the selected dates');
    }

    // 3. Compute price server-side
    const total_price = calcTotalPrice(room.price_per_night, check_in, check_out);

    // 4. Insert the booking
    //    Schema EXCLUDE constraint is the final atomic guard against race conditions
    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, total_price, guests, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [user_id, room_id, check_in, check_out, total_price, guests]
    );

    await client.query('COMMIT');
    return bookingRows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // re-throw so controller can send the right HTTP response
  } finally {
    client.release(); // always return client to pool
  }
};

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

/**
 * Get a single booking by ID with full details (room + hotel info).
 * Single query — no N+1.
 */
export const findBookingById = async (id) => {
  const sql = `
    SELECT
      b.id, b.user_id, b.room_id, b.check_in, b.check_out,
      b.total_price, b.status, b.created_at,

      -- Room details
      r.room_type, r.capacity AS room_capacity, r.price_per_night,

      -- Hotel details
      h.id           AS hotel_id,
      h.owner_id     AS hotel_owner_id,
      h.name         AS hotel_name,
      h.city         AS hotel_city,
      h.country      AS hotel_country,

      -- Primary image
      (SELECT image_url FROM hotel_images
       WHERE  hotel_id = h.id AND is_primary = TRUE LIMIT 1) AS hotel_image

    FROM   bookings b
    JOIN   rooms    r ON r.id = b.room_id
    JOIN   hotels   h ON h.id = r.hotel_id
    WHERE  b.id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Get all bookings for a user — cursor-based pagination.
 * Most recent first.
 */
export const findBookingsByUser = async ({ user_id, limit = 10, after_id = null }) => {
  const values     = [user_id];
  let   cursorClause = '';

  if (after_id) {
    values.push(after_id);
    cursorClause = `AND b.id < $${values.length}`; // descending cursor
  }

  values.push(limit + 1);
  const sql = `
    SELECT
      b.id, b.check_in, b.check_out, b.guests, b.total_price, b.status, b.created_at,
      r.room_type,  r.capacity AS room_capacity,
      h.id      AS hotel_id,
      h.name    AS hotel_name,
      h.city    AS hotel_city,
      h.country AS hotel_country,
      (SELECT image_url FROM hotel_images
       WHERE  hotel_id = h.id AND is_primary = TRUE LIMIT 1) AS hotel_image
    FROM   bookings b
    JOIN   rooms    r ON r.id = b.room_id
    JOIN   hotels   h ON h.id = r.hotel_id
    WHERE  b.user_id = $1
      ${cursorClause}
    ORDER  BY b.created_at DESC, b.id DESC
    LIMIT  $${values.length}
  `;

  const { rows } = await query(sql, values);

  const hasNextPage = rows.length > limit;
  const bookings    = hasNextPage ? rows.slice(0, limit) : rows;
  const nextCursor  = hasNextPage ? bookings[bookings.length - 1].id : null;

  return { bookings, nextCursor, hasNextPage };
};

/**
 * Get all bookings for a host's hotel (for host dashboard).
 */
export const findBookingsByHotel = async ({ hotel_id, limit = 20, after_id = null }) => {
  const values     = [hotel_id];
  let   cursorClause = '';

  if (after_id) {
    values.push(after_id);
    cursorClause = `AND b.id < $${values.length}`;
  }

  values.push(limit + 1);
  const sql = `
    SELECT
      b.id, b.user_id, b.check_in, b.check_out,
      b.total_price, b.status, b.created_at,
      u.name  AS guest_name,
      u.email AS guest_email,
      r.room_type
    FROM   bookings b
    JOIN   rooms    r ON r.id       = b.room_id
    JOIN   hotels   h ON h.id       = r.hotel_id
    JOIN   users    u ON u.id       = b.user_id
    WHERE  h.id = $1
      ${cursorClause}
    ORDER  BY b.created_at DESC, b.id DESC
    LIMIT  $${values.length}
  `;

  const { rows } = await query(sql, values);

  const hasNextPage = rows.length > limit;
  const bookings    = hasNextPage ? rows.slice(0, limit) : rows;
  const nextCursor  = hasNextPage ? bookings[bookings.length - 1].id : null;

  return { bookings, nextCursor, hasNextPage };
};

// ─────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────

/**
 * Confirm a booking (host action).
 */
export const confirmBooking = async (id) => {
  const sql = `
    UPDATE bookings
    SET    status = 'confirmed'
    WHERE  id     = $1
      AND  status = 'pending'        -- guard: can only confirm a pending booking
    RETURNING *
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Cancel a booking.
 * Only pending or confirmed bookings can be cancelled.
 * The schema EXCLUDE constraint skips cancelled bookings, so the slot
 * opens up immediately for new bookings.
 */
export const cancelBooking = async (id) => {
  const sql = `
    UPDATE bookings
    SET    status = 'cancelled'
    WHERE  id     = $1
      AND  status IN ('pending', 'confirmed')   -- guard: can't cancel an already-cancelled booking
    RETURNING *
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// HELPERS FOR CONTROLLERS
// ─────────────────────────────────────────────

/**
 * Verify that a booking belongs to a specific user.
 * Used by auth middleware / controller before allowing cancel.
 */
export const isBookingOwner = async (booking_id, user_id) => {
  const sql = `
    SELECT EXISTS (
      SELECT 1 FROM bookings
      WHERE  id      = $1
        AND  user_id = $2
    ) AS is_owner
  `;
  const { rows } = await query(sql, [booking_id, user_id]);
  return rows[0].is_owner;
};

/**
 * Check if a user has a completed (confirmed, non-cancelled) booking
 * at a specific hotel — required before allowing a review.
 */
export const hasCompletedBookingForHotel = async (user_id, hotel_id) => {
  const sql = `
    SELECT EXISTS (
      SELECT 1
      FROM   bookings b
      JOIN   rooms    r ON r.id = b.room_id
      WHERE  b.user_id = $1
        AND  r.hotel_id = $2
        AND  b.status   = 'confirmed'
        AND  b.check_out <= CURRENT_DATE     -- stay must have ended
    ) AS has_booking
  `;
  const { rows } = await query(sql, [user_id, hotel_id]);
  return rows[0].has_booking;
};
