// backend/src/middlewares/auth.middleware.js
import { verifyAccessToken } from '../utils/jwt.js';

// ─────────────────────────────────────────────
// isAuthenticated
// Reads the Bearer access token from the Authorization header.
// Sets req.user = { id, role } on success so downstream middleware
// and controllers can use req.user.id / req.user.role.
//
// On expiry it returns code: 'TOKEN_EXPIRED' so the frontend
// knows to call POST /api/auth/refresh and retry.
// ─────────────────────────────────────────────
export const isAuthenticated = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
    });
  }

  const token = header.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);  // { id, role, type, iat, exp }
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token expired',
        code:    'TOKEN_EXPIRED',          // frontend uses this to trigger a silent refresh
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid access token',
    });
  }
};

// ─────────────────────────────────────────────
// isHost
// Protects routes that only a host or admin can access.
// e.g. create hotel, add room, view hotel bookings.
// Must be used AFTER isAuthenticated.
// ─────────────────────────────────────────────
export const isHost = (req, res, next) => {
  if (req.user.role === 'host' || req.user.role === 'admin') return next();

  return res.status(403).json({
    success: false,
    message: 'Only hosts can perform this action',
  });
};

// ─────────────────────────────────────────────
// isAdmin
// Protects admin-only routes.
// e.g. promote a user role, view all bookings.
// Must be used AFTER isAuthenticated.
// ─────────────────────────────────────────────
export const isAdmin = (req, res, next) => {
  if (req.user.role === 'admin') return next();

  return res.status(403).json({
    success: false,
    message: 'Admin access only',
  });
};

// ─────────────────────────────────────────────
// isOwnerOrAdmin
// Protects routes where only the resource owner
// or an admin should have access.
// e.g. cancel my own booking, delete my own review.
//
// Usage: pass a function that extracts the owner id
// from the request to compare against req.user.id
//
// Example:
//   router.patch('/:id/cancel',
//     isAuthenticated,
//     isOwnerOrAdmin((req) => req.booking.user_id),
//     cancelBookingHandler
//   )
// ─────────────────────────────────────────────
export const isOwnerOrAdmin = (getOwnerId) => (req, res, next) => {
  const ownerId = getOwnerId(req);

  if (req.user.role === 'admin' || req.user.id === ownerId) return next();

  return res.status(403).json({
    success: false,
    message: 'You do not have permission to perform this action',
  });
};
