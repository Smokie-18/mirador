// backend/src/controllers/hotel.controller.js
import {
  createHotel,
  searchHotels,
  findHotelById,
  findHotelsByOwner,
  updateHotel,
  deleteHotel,
  addHotelImage,
  deleteHotelImage,
} from '../models/hotel.model.js';
import {
  createRoom,
  findRoomsByHotel,
  findAvailableRooms,
  updateRoom,
  setRoomAvailability,
  deleteRoom,
  hasActiveBookings,
} from '../models/room.model.js';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Verify the logged-in host owns the hotel before any mutation.
 * Returns the hotel row or sends 403/404.
 */
const assertHotelOwnership = async (res, hotel_id, user) => {
  const hotel = await findHotelById(hotel_id);
  if (!hotel) {
    res.status(404).json({ success: false, message: 'Hotel not found' });
    return null;
  }
  // Admin can bypass ownership check
  if (hotel.owner_id !== user.id && user.role !== 'admin') {
    res.status(403).json({ success: false, message: 'You do not own this hotel' });
    return null;
  }
  return hotel;
};

// ─────────────────────────────────────────────
// HOTELS — CRUD
// ─────────────────────────────────────────────

// POST /api/hotels
export const createHotelHandler = async (req, res, next) => {
  try {
    const { name, description, city, country, latitude, longitude, price_per_night } = req.body;

    if (!name || !city || !country || !price_per_night) {
      return res.status(400).json({
        success: false,
        message: 'name, city, country and price_per_night are required',
      });
    }

    const hotel = await createHotel({
      owner_id: req.user.id,
      name, description, city, country, latitude, longitude, price_per_night,
    });

    return res.status(201).json({ success: true, hotel });
  } catch (err) {
    next(err);
  }
};

// GET /api/hotels?city=&min_price=&max_price=&min_rating=&limit=&after_id=&after_created_at=
export const searchHotelsHandler = async (req, res, next) => {
  try {
    const { city, min_price, max_price, min_rating, limit, after_id, after_created_at } = req.query;

    const result = await searchHotels({
      city,
      min_price:        min_price        ? Number(min_price)        : undefined,
      max_price:        max_price        ? Number(max_price)        : undefined,
      min_rating:       min_rating       ? Number(min_rating)       : undefined,
      limit:            limit            ? Math.min(Number(limit), 50) : 20,  // cap at 50
      after_id:         after_id         ?? null,
      after_created_at: after_created_at ?? null,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

// GET /api/hotels/my  — host sees their own hotels
export const getMyHotelsHandler = async (req, res, next) => {
  try {
    const hotels = await findHotelsByOwner(req.user.id);
    return res.status(200).json({ success: true, hotels });
  } catch (err) {
    next(err);
  }
};

// GET /api/hotels/:id
export const getHotelHandler = async (req, res, next) => {
  try {
    const hotel = await findHotelById(req.params.id);
    if (!hotel) {
      return res.status(404).json({ success: false, message: 'Hotel not found' });
    }
    return res.status(200).json({ success: true, hotel });
  } catch (err) {
    next(err);
  }
};

// PUT /api/hotels/:id
export const updateHotelHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.id, req.user);
    if (!hotel) return; // response already sent

    const updated = await updateHotel(req.params.id, req.body);
    return res.status(200).json({ success: true, hotel: updated });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/hotels/:id
export const deleteHotelHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.id, req.user);
    if (!hotel) return;

    const deleted = await deleteHotel(req.params.id);
    return res.status(200).json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// ROOMS
// ─────────────────────────────────────────────

// POST /api/hotels/:id/rooms
export const addRoomHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.id, req.user);
    if (!hotel) return;

    const { room_type, capacity, price_per_night } = req.body;

    if (!room_type || !capacity || !price_per_night) {
      return res.status(400).json({
        success: false,
        message: 'room_type, capacity and price_per_night are required',
      });
    }

    const room = await createRoom({
      hotel_id: req.params.id,
      room_type, capacity, price_per_night,
    });

    return res.status(201).json({ success: true, room });
  } catch (err) {
    next(err);
  }
};

// GET /api/hotels/:id/rooms?check_in=&check_out=&guests=
export const getRoomsHandler = async (req, res, next) => {
  try {
    const { check_in, check_out, guests } = req.query;

    // If dates provided → return only available rooms for those dates
    if (check_in && check_out) {
      const rooms = await findAvailableRooms({
        hotel_id: req.params.id,
        check_in,
        check_out,
        guests: guests ? Number(guests) : 1,
      });
      return res.status(200).json({ success: true, rooms });
    }

    // No dates → return all rooms (for hotel detail page)
    const rooms = await findRoomsByHotel(req.params.id);
    return res.status(200).json({ success: true, rooms });
  } catch (err) {
    next(err);
  }
};

// PUT /api/hotels/:hotelId/rooms/:roomId
export const updateRoomHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.hotelId, req.user);
    if (!hotel) return;

    const updated = await updateRoom(req.params.roomId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    return res.status(200).json({ success: true, room: updated });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/hotels/:hotelId/rooms/:roomId/availability
export const setRoomAvailabilityHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.hotelId, req.user);
    if (!hotel) return;

    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ success: false, message: 'is_available must be a boolean' });
    }

    const updated = await setRoomAvailability(req.params.roomId, is_available);
    return res.status(200).json({ success: true, room: updated });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/hotels/:hotelId/rooms/:roomId
export const deleteRoomHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.hotelId, req.user);
    if (!hotel) return;

    // Pre-check: block delete if active bookings exist
    const active = await hasActiveBookings(req.params.roomId);
    if (active) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete room with active bookings',
      });
    }

    const deleted = await deleteRoom(req.params.roomId);
    return res.status(200).json({ success: true, deleted });
  } catch (err) {
    // Race condition safety net:
    // A booking could be created between hasActiveBookings() and deleteRoom().
    // PostgreSQL FK constraint (23503) fires and we catch it here cleanly
    // instead of leaking the raw DB error to the client.
    if (err.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete room — a booking was just created for it. Try again.',
      });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────
// HOTEL IMAGES
// ─────────────────────────────────────────────

// POST /api/hotels/:id/images
export const addImageHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.id, req.user);
    if (!hotel) return;

    const { image_url, is_primary } = req.body;
    if (!image_url) {
      return res.status(400).json({ success: false, message: 'image_url is required' });
    }

    const image = await addHotelImage(req.params.id, image_url, is_primary ?? false);
    return res.status(201).json({ success: true, image });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/hotels/:id/images/:imageId
export const deleteImageHandler = async (req, res, next) => {
  try {
    const hotel = await assertHotelOwnership(res, req.params.id, req.user);
    if (!hotel) return;

    const deleted = await deleteHotelImage(req.params.imageId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    return res.status(200).json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
};
