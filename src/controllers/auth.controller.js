// backend/src/controllers/auth.controller.js
import {
  registerUser,
  updateUserRole,
  findUserById,
  findUserWithPasswordByEmail,
  verifyPassword,
} from '../models/user.model.js';
import {
  generateTokens,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../utils/jwt.js';

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
export const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'name, email and password are required',
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters',
      });
    }

    const user = await registerUser({ name, email, password });
    const { accessToken, refreshToken } = generateTokens(user);

    setRefreshCookie(res, refreshToken);

    // Return the access token in the body — frontend stores it in memory (not localStorage)
    return res.status(201).json({ success: true, accessToken, user });
  } catch (err) {
    const knownErrors = [
      'Email already registered. Please log in.',
      'This email is linked to a Google account. Please sign in with Google.',
    ];
    if (knownErrors.includes(err.message)) {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/login
// Email + password — no Passport needed, plain bcrypt check
// ─────────────────────────────────────────────
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    // Fetch user WITH hash — the only place this is called
    const user = await findUserWithPasswordByEmail(email);

    // Vague message — never reveal whether the email or the password was wrong
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const { password_hash, ...safeUser } = user;
    const { accessToken, refreshToken } = generateTokens(safeUser);

    setRefreshCookie(res, refreshToken);

    return res.status(200).json({ success: true, accessToken, user: safeUser });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/refresh
// Uses the httpOnly refresh token cookie to issue a new access token.
// Also rotates the refresh token (new cookie replaces old one).
//
// Called automatically by the frontend:
//   1. On page load — restores the session silently
//   2. When any API request returns { code: 'TOKEN_EXPIRED' }
// ─────────────────────────────────────────────
export const refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token missing — please log in',
      });
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      clearRefreshCookie(res);
      const message = err.name === 'TokenExpiredError'
        ? 'Session expired — please log in again'
        : 'Invalid refresh token';
      return res.status(401).json({ success: false, message });
    }

    // Re-fetch user from DB so the new access token has the latest role
    const user = await findUserById(decoded.id);
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    // Rotate: issue fresh pair, overwrite the old refresh cookie
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    setRefreshCookie(res, newRefreshToken);

    return res.status(200).json({ success: true, accessToken, user });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// GET /api/auth/me
// Returns the full user profile.
// req.user only has { id, role } from the JWT payload — we fetch
// name/email/avatar_url/created_at from the DB here.
// ─────────────────────────────────────────────
export const getMe = async (req, res, next) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /api/auth/logout
// Clears the refresh token cookie.
// The access token expires on its own (15 min) — the client should
// discard it from memory immediately on logout.
// No auth required — anyone can call this.
// ─────────────────────────────────────────────
export const logout = (req, res) => {
  clearRefreshCookie(res);
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
};

// ─────────────────────────────────────────────
// PATCH /api/auth/role
// Guest upgrades themselves to host.
// ─────────────────────────────────────────────
export const upgradeToHost = async (req, res, next) => {
  try {
    if (req.user.role !== 'guest') {
      return res.status(400).json({
        success: false,
        message: `Your role is already '${req.user.role}'`,
      });
    }

    const updated = await updateUserRole(req.user.id, 'host');
    return res.status(200).json({
      success: true,
      message: 'You are now a host. You can list hotels.',
      user: updated,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// PATCH /api/auth/admin/role  (admin only)
// Lets an admin set any user's role.
// ─────────────────────────────────────────────
export const setUserRole = async (req, res, next) => {
  try {
    const { userId, role } = req.body;
    const allowed = ['guest', 'host', 'admin'];

    if (!allowed.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${allowed.join(', ')}`,
      });
    }

    const updated = await updateUserRole(userId, role);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
};
