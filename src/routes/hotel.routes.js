// backend/src/routes/hotel.routes.js
import { Router } from 'express';
import { isAuthenticated, isHost } from '../middlewares/auth.middleware.js';
import {
  createHotelHandler,
  searchHotelsHandler,
  getMyHotelsHandler,
  getHotelHandler,
  updateHotelHandler,
  deleteHotelHandler,
  addRoomHandler,
  getRoomsHandler,
  updateRoomHandler,
  setRoomAvailabilityHandler,
  deleteRoomHandler,
  addImageHandler,
  deleteImageHandler,
} from '../controllers/hotel.controller.js';

const router = Router();

// ─────────────────────────────────────────────
// HOTELS
// ─────────────────────────────────────────────
// Public
router.get('/',           searchHotelsHandler);       // GET  /api/hotels
router.get('/my',         isAuthenticated, isHost, getMyHotelsHandler); // GET  /api/hotels/my
router.get('/:id',        getHotelHandler);           // GET  /api/hotels/:id

// Host only
router.post('/',          isAuthenticated, isHost, createHotelHandler);   // POST   /api/hotels
router.put('/:id',        isAuthenticated, isHost, updateHotelHandler);   // PUT    /api/hotels/:id
router.delete('/:id',     isAuthenticated, isHost, deleteHotelHandler);   // DELETE /api/hotels/:id

// ─────────────────────────────────────────────
// ROOMS  (nested under hotel)
// ─────────────────────────────────────────────
// Public — with optional date filter for availability
router.get('/:id/rooms',                              getRoomsHandler);    // GET /api/hotels/:id/rooms

// Host only
router.post('/:id/rooms',                  isAuthenticated, isHost, addRoomHandler);              // POST   /api/hotels/:id/rooms
router.put('/:hotelId/rooms/:roomId',      isAuthenticated, isHost, updateRoomHandler);           // PUT    /api/hotels/:hotelId/rooms/:roomId
router.patch('/:hotelId/rooms/:roomId/availability', isAuthenticated, isHost, setRoomAvailabilityHandler); // PATCH  /api/hotels/:hotelId/rooms/:roomId/availability
router.delete('/:hotelId/rooms/:roomId',   isAuthenticated, isHost, deleteRoomHandler);           // DELETE /api/hotels/:hotelId/rooms/:roomId

// ─────────────────────────────────────────────
// IMAGES  (nested under hotel)
// ─────────────────────────────────────────────
router.post('/:id/images',              isAuthenticated, isHost, addImageHandler);    // POST   /api/hotels/:id/images
router.delete('/:id/images/:imageId',   isAuthenticated, isHost, deleteImageHandler); // DELETE /api/hotels/:id/images/:imageId

export default router;
