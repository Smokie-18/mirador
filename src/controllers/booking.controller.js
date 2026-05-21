// backend/src/controllers/booking.controller.js
import {
  createBooking,
  findBookingById,
  findBookingsByUser,
  findBookingsByHotel,
  confirmBooking,
  cancelBooking,
  isBookingOwner,
} from '../models/booking.model.js';
import { findHotelsByOwner } from '../models/hotel.model.js';

// ─────────────────────────────────────────────────────────────────
// CONCURRENCY — how double-booking is prevented end-to-end
//
//  Layer 1 → SELECT FOR UPDATE in createBooking()
//            Locks the room row for the life of the transaction.
//            Two simultaneous requests → one waits, one proceeds.
//
//  Layer 2 → App-level date overlap check (inside same transaction)
//            Readable error message before hitting the DB constraint.
//
//  Layer 3 → Schema EXCLUDE USING gist constraint
//            Atomic DB-level guard. Even if layers 1 & 2 somehow
//            both pass (e.g. direct DB access), this throws a
//            PostgreSQL error 23P01 (exclusion_violation).
//
//  Layer 4 → Controller catches PostgreSQL error code 23P01
//            and maps it to a clean 409 Conflict for the client.
// ─────────────────────────────────────────────────────────────────

// Postgres error codes we handle explicitly
const PG_ERRORS = {
  EXCLUSION_VIOLATION: '23P01', // EXCLUDE constraint violated (double-booking)
  FOREIGN_KEY:         '23503', // FK violation (room/user deleted mid-request)
  UNIQUE_VIOLATION:    '23505', // e.g. duplicate review
};

/**
 * Map known DB / app errors to clean HTTP responses.
 * Unknown errors bubble up to the global error handler.
 */
const handleBookingError = (err, res, next) => {
  // Layer 4: schema exclusion constraint fired — true race condition caught
  if (err.code === PG_ERRORS.EXCLUSION_VIOLATION) {
    return res.status(409).json({
      success: false,
      message: 'Room was just booked by someone else for those dates. Please choose different dates or another room.',
    });
  }

  // FK violation — room or user no longer exists
  if (err.code === PG_ERRORS.FOREIGN_KEY) {
    return res.status(404).json({
      success: false,
      message: 'Room or user no longer exists',
    });
  }

  // App-level errors thrown from the model (Layers 1-3 messages)
  const knownMessages = [
    'Room not found',
    'Room is not available for booking',
    'Room is already booked for the selected dates',
    'check_out must be after check_in',
  ];
  if (knownMessages.includes(err.message)) {
    return res.status(409).json({ success: false, message: err.message });
  }

  next(err); // unknown error → global handler
};

// ─────────────────────────────────────────────
// CREATE BOOKING
// POST /api/bookings
// ─────────────────────────────────────────────
export const createBookingHandler = async (req, res, next) => {
  try {
    const { room_id, check_in, check_out, guests = 1 } = req.body;

    if (!room_id || !check_in || !check_out) {
      return res.status(400).json({
        success: false,
        message: 'room_id, check_in and check_out are required',
      });
    }

    // Validate date format before hitting the DB
    const inDate  = new Date(check_in);
    const outDate = new Date(check_out);

    if (isNaN(inDate) || isNaN(outDate)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Use YYYY-MM-DD',
      });
    }

    if (inDate < new Date().setHours(0, 0, 0, 0)) {
      return res.status(400).json({
        success: false,
        message: 'check_in cannot be in the past',
      });
    }

    // createBooking runs all 3 concurrency layers internally
    const booking = await createBooking({
      user_id:   req.user.id,
      room_id,
      check_in,
      check_out,
      guests:    Math.min(Math.max(Number(guests) || 1, 1), 20),
    });

    return res.status(201).json({ success: true, booking });
  } catch (err) {
    handleBookingError(err, res, next);
  }
};

// ─────────────────────────────────────────────
// GET MY BOOKINGS
// GET /api/bookings?limit=&after_id=
// ─────────────────────────────────────────────
export const getMyBookingsHandler = async (req, res, next) => {
  try {
    const { limit, after_id } = req.query;

    const result = await findBookingsByUser({
      user_id:  req.user.id,
      limit:    limit ? Math.min(Number(limit), 50) : 10,
      after_id: after_id ?? null,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET SINGLE BOOKING
// GET /api/bookings/:id
// ─────────────────────────────────────────────
export const getBookingHandler = async (req, res, next) => {
  try {
    const booking = await findBookingById(req.params.id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Only the guest who booked OR the hotel owner OR admin can view
    const isGuest = booking.user_id === req.user.id;
    const isAdmin = req.user.role  === 'admin';

    if (!isGuest && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.status(200).json({ success: true, booking });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CONFIRM BOOKING  (host action)
// PATCH /api/bookings/:id/confirm
// ─────────────────────────────────────────────
export const confirmBookingHandler = async (req, res, next) => {
  try {
    const booking = await findBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Only the hotel owner or admin can confirm
    const ownsHotel = req.user.role === 'host' && booking.hotel_owner_id === req.user.id;
    const isAdmin   = req.user.role === 'admin';

    if (!ownsHotel && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only the hotel owner can confirm bookings' });
    }

    const confirmed = await confirmBooking(req.params.id);
    if (!confirmed) {
      return res.status(409).json({
        success: false,
        message: 'Booking can only be confirmed when in pending status',
      });
    }

    return res.status(200).json({ success: true, booking: confirmed });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// CANCEL BOOKING
// PATCH /api/bookings/:id/cancel
// Guest can cancel their own | Admin can cancel any
// ─────────────────────────────────────────────
export const cancelBookingHandler = async (req, res, next) => {
  try {
    // Verify ownership before any mutation
    const owner = await isBookingOwner(req.params.id, req.user.id);

    if (!owner && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own bookings',
      });
    }

    const cancelled = await cancelBooking(req.params.id);

    if (!cancelled) {
      return res.status(409).json({
        success: false,
        message: 'Booking cannot be cancelled. It may already be cancelled.',
      });
    }

    // Cancellation frees the slot immediately — schema EXCLUDE skips cancelled rows
    return res.status(200).json({
      success: true,
      message: 'Booking cancelled. The slot is now available for others.',
      booking: cancelled,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET HOTEL BOOKINGS  (host dashboard)
// GET /api/bookings/hotel/:hotelId?limit=&after_id=
// ─────────────────────────────────────────────
export const getHotelBookingsHandler = async (req, res, next) => {
  try {
    const { limit, after_id } = req.query;

    // Verify the host owns this hotel
    const myHotels = await findHotelsByOwner(req.user.id);
    const ownsHotel = myHotels.some(h => h.id === req.params.hotelId);

    if (!ownsHotel && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You do not own this hotel',
      });
    }

    const result = await findBookingsByHotel({
      hotel_id: req.params.hotelId,
      limit:    limit ? Math.min(Number(limit), 50) : 20,
      after_id: after_id ?? null,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};
