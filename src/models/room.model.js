// backend/src/models/room.model.js
import { query } from '../config/db.js';

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

/**
 * Add a room to a hotel.
 * hotel_id ownership check must be done in the controller before calling this.
 */
export const createRoom = async ({ hotel_id, room_type, capacity, price_per_night }) => {
  const sql = `
    INSERT INTO rooms (hotel_id, room_type, capacity, price_per_night)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const { rows } = await query(sql, [hotel_id, room_type, capacity, price_per_night]);
  return rows[0];
};

// ─────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────

/**
 * Get all rooms for a hotel.
 */
export const findRoomsByHotel = async (hotel_id) => {
  const sql = `
    SELECT id, hotel_id, room_type, capacity, price_per_night, is_available
    FROM   rooms
    WHERE  hotel_id = $1
    ORDER  BY price_per_night ASC
  `;
  const { rows } = await query(sql, [hotel_id]);
  return rows;
};

/**
 * Get a single room by ID.
 */
export const findRoomById = async (id) => {
  const sql = `
    SELECT id, hotel_id, room_type, capacity, price_per_night, is_available
    FROM   rooms
    WHERE  id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Find available rooms for a hotel within a date range.
 *
 * Scalability:
 *  - Uses a NOT EXISTS subquery instead of a LEFT JOIN + IS NULL pattern —
 *    short-circuits as soon as one conflicting booking is found per room.
 *  - Filters out cancelled bookings (they don't block the slot).
 *  - Filters by capacity so the UI only shows rooms that fit the guest count.
 */
export const findAvailableRooms = async ({ hotel_id, check_in, check_out, guests = 1 }) => {
  const sql = `
    SELECT id, hotel_id, room_type, capacity, price_per_night, is_available
    FROM   rooms r
    WHERE  r.hotel_id     = $1
      AND  r.capacity    >= $2
      AND  r.is_available = TRUE
      AND  NOT EXISTS (
        SELECT 1
        FROM   bookings b
        WHERE  b.room_id  = r.id
          AND  b.status  <> 'cancelled'
          AND  daterange(b.check_in, b.check_out, '[)') &&
               daterange($3::date, $4::date, '[)')
      )
    ORDER  BY r.price_per_night ASC
  `;
  const { rows } = await query(sql, [hotel_id, guests, check_in, check_out]);
  return rows;
};

// ─────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────

/**
 * Update room details. Only updates fields that are provided.
 */
export const updateRoom = async (id, fields) => {
  const allowed = ['room_type', 'capacity', 'price_per_night', 'is_available'];
  const updates = [];
  const values  = [];
  let   idx     = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }

  if (updates.length === 0) return null;

  values.push(id);
  const sql = `
    UPDATE rooms
    SET    ${updates.join(', ')}
    WHERE  id = $${idx}
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] ?? null;
};

/**
 * Toggle room availability.
 * Shortcut used when a host wants to quickly take a room off/on the market.
 */
export const setRoomAvailability = async (id, is_available) => {
  const sql = `
    UPDATE rooms
    SET    is_available = $1
    WHERE  id = $2
    RETURNING id, is_available
  `;
  const { rows } = await query(sql, [is_available, id]);
  return rows[0] ?? null;
};

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────

/**
 * Delete a room.
 * Will fail if active (non-cancelled) bookings exist for this room —
 * the controller should check for active bookings before calling this.
 */
export const deleteRoom = async (id) => {
  const sql = `
    DELETE FROM rooms
    WHERE  id = $1
    RETURNING id, room_type
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] ?? null;
};

/**
 * Check whether a room has any active (non-cancelled) bookings.
 * Used by the controller before allowing a host to delete a room.
 */
export const hasActiveBookings = async (room_id) => {
  const sql = `
    SELECT EXISTS (
      SELECT 1 FROM bookings
      WHERE  room_id = $1
        AND  status <> 'cancelled'
    ) AS has_active
  `;
  const { rows } = await query(sql, [room_id]);
  return rows[0].has_active;
};
