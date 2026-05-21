// backend/src/routes/booking.routes.js
import { Router } from 'express';
import { isAuthenticated, isHost } from '../middlewares/auth.middleware.js';
import {
  createBookingHandler,
  getMyBookingsHandler,
  getBookingHandler,
  confirmBookingHandler,
  cancelBookingHandler,
  getHotelBookingsHandler,
} from '../controllers/booking.controller.js';

const router = Router();

// All booking routes require login
router.use(isAuthenticated);

// ─────────────────────────────────────────────
// GUEST ROUTES
// ─────────────────────────────────────────────
router.post('/',          createBookingHandler);    // POST  /api/bookings
router.get('/',           getMyBookingsHandler);    // GET   /api/bookings
router.get('/:id',        getBookingHandler);       // GET   /api/bookings/:id
router.patch('/:id/cancel', cancelBookingHandler);  // PATCH /api/bookings/:id/cancel

// ─────────────────────────────────────────────
// HOST ROUTES
// ─────────────────────────────────────────────
router.patch('/:id/confirm',          isHost, confirmBookingHandler);      // PATCH /api/bookings/:id/confirm
router.get('/hotel/:hotelId',         isHost, getHotelBookingsHandler);    // GET   /api/bookings/hotel/:hotelId

export default router;
