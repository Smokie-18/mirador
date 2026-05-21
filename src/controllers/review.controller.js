// backend/src/controllers/review.controller.js
import {
  createReview,
  findReviewsByHotel,
  findReviewsByUser,
  findReviewById,
  deleteReview,
  isReviewOwner,
} from '../models/review.model.js';

// ─────────────────────────────────────────────────────────────
// AUTHENTICATION GATES (enforced before reaching any handler)
//
//  Gate 1 → isAuthenticated middleware    req.user exists
//  Gate 2 → assertReviewEligibility()    confirmed stay + not reviewed yet (in model)
//  Gate 3 → schema UNIQUE on booking_id  atomic DB-level dedup guard
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────
// CREATE REVIEW
// POST /api/reviews
// ─────────────────────────────────────────────
export const createReviewHandler = async (req, res, next) => {
  try {
    const { hotel_id, booking_id, rating, comment } = req.body;

    // Input validation
    if (!hotel_id || !booking_id || !rating) {
      return res.status(400).json({
        success: false,
        message: 'hotel_id, booking_id and rating are required',
      });
    }

    if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'rating must be a whole number between 1 and 5',
      });
    }

    // createReview runs Gates 2 & 3 internally inside a transaction
    // Gate 1 already passed — req.user is guaranteed by isAuthenticated middleware
    const review = await createReview({
      user_id:    req.user.id,
      hotel_id,
      booking_id,
      rating:     Number(rating),
      comment:    comment ?? null,
    });

    return res.status(201).json({ success: true, review });
  } catch (err) {
    // Gate 2 violations — thrown from assertReviewEligibility()
    const eligibilityErrors = [
      'You can only review a hotel after completing a confirmed stay',
      'You have already reviewed this booking',
    ];

    if (eligibilityErrors.includes(err.message)) {
      return res.status(403).json({ success: false, message: err.message });
    }

    // Gate 3 — schema UNIQUE constraint on booking_id fired
    // (race condition: two simultaneous review submissions for same booking)
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A review for this booking was just submitted. You can only review once per stay.',
      });
    }

    next(err);
  }
};

// ─────────────────────────────────────────────
// GET REVIEWS FOR A HOTEL
// GET /api/reviews/hotel/:hotelId?limit=&after_id=
// Public — no auth required
// ─────────────────────────────────────────────
export const getHotelReviewsHandler = async (req, res, next) => {
  try {
    const { limit, after_id } = req.query;

    const result = await findReviewsByHotel({
      hotel_id: req.params.hotelId,
      limit:    limit ? Math.min(Number(limit), 50) : 10,
      after_id: after_id ?? null,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET MY REVIEWS
// GET /api/reviews/me
// Authenticated user sees all reviews they've written
// ─────────────────────────────────────────────
export const getMyReviewsHandler = async (req, res, next) => {
  try {
    const reviews = await findReviewsByUser(req.user.id);
    return res.status(200).json({ success: true, reviews });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// DELETE REVIEW
// DELETE /api/reviews/:id
// Only the review author or admin can delete
// ─────────────────────────────────────────────
export const deleteReviewHandler = async (req, res, next) => {
  try {
    const review = await findReviewById(req.params.id);

    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Ownership check — must be the author or an admin
    const owner = await isReviewOwner(req.params.id, req.user.id);
    if (!owner && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own reviews',
      });
    }

    // deleteReview triggers DB trigger → auto-recalculates hotel avg_rating + total_reviews
    const deleted = await deleteReview(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Review deleted. Hotel rating has been recalculated.',
      deleted,
    });
  } catch (err) {
    next(err);
  }
};
