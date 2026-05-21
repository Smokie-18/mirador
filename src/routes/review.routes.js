// backend/src/routes/review.routes.js
import { Router } from 'express';
import { isAuthenticated } from '../middlewares/auth.middleware.js';
import {
  createReviewHandler,
  getHotelReviewsHandler,
  getMyReviewsHandler,
  deleteReviewHandler,
} from '../controllers/review.controller.js';

const router = Router();

// ─────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────

// GET /api/reviews/hotel/:hotelId  — anyone can read reviews
router.get('/hotel/:hotelId', getHotelReviewsHandler);

// ─────────────────────────────────────────────
// AUTHENTICATED
// ─────────────────────────────────────────────

// POST /api/reviews              — create review (Gates 1+2+3 enforced)
router.post('/', isAuthenticated, createReviewHandler);

// GET  /api/reviews/me           — my review history
router.get('/me', isAuthenticated, getMyReviewsHandler);

// DELETE /api/reviews/:id        — delete own review (or admin)
router.delete('/:id', isAuthenticated, deleteReviewHandler);

export default router;
