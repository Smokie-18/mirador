// backend/src/utils/jwt.js
//
// Two-token strategy:
//   Access token  — short-lived (15 min), carries { id, role }
//                   sent as   Authorization: Bearer <token>
//   Refresh token — long-lived (7 days), carries only { id }
//                   stored in an httpOnly cookie — JS cannot read it (XSS-safe)
//
// Both are signed with JWT_SECRET from .env.
// Add  JWT_SECRET=<long random string>  to your .env file.

import jwt from 'jsonwebtoken';

const ACCESS_EXPIRY  = '15m';   // how long until the access token expires
const REFRESH_EXPIRY = '7d';    // how long until the refresh token expires

// ─────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────

/**
 * Generates both tokens for a user.
 * Call after successful login / register / Google OAuth.
 */
export const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user.id, role: user.role, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  );

  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },   // minimal payload — only id needed to re-mint access
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY }
  );

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────
// TOKEN VERIFICATION
// ─────────────────────────────────────────────

/**
 * Verifies an access token.
 * Throws if expired, invalid, or wrong type.
 */
export const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.type !== 'access') throw new Error('Wrong token type');
  return decoded; // { id, role, type, iat, exp }
};

/**
 * Verifies a refresh token.
 * Throws if expired, invalid, or wrong type.
 */
export const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.type !== 'refresh') throw new Error('Wrong token type');
  return decoded; // { id, type, iat, exp }
};

// ─────────────────────────────────────────────
// COOKIE HELPERS
// ─────────────────────────────────────────────

/**
 * Writes the refresh token into a secure httpOnly cookie.
 *   httpOnly  → JavaScript cannot read it (XSS protection)
 *   sameSite  → sent on top-level navigations (needed for Google OAuth redirect)
 *   secure    → HTTPS-only in production
 */
export const setRefreshCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   7 * 24 * 60 * 60 * 1000,   // 7 days in ms
  });
};

/**
 * Clears the refresh token cookie (call on logout or invalid token).
 * Options must match the ones used in setRefreshCookie, otherwise
 * the browser will not delete the cookie.
 */
export const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
  });
};
