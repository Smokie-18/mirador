// backend/src/routes/auth.routes.js
import { Router } from 'express';
import passport from 'passport';
import {
  register,
  login,
  refresh,
  getMe,
  logout,
  upgradeToHost,
  setUserRole,
} from '../controllers/auth.controller.js';
import { isAuthenticated, isAdmin } from '../middlewares/auth.middleware.js';
import { generateTokens, setRefreshCookie } from '../utils/jwt.js';

const router = Router();

// ─────────────────────────────────────────────
// EMAIL + PASSWORD
// ─────────────────────────────────────────────
router.post('/register', register);
router.post('/login',    login);

// ─────────────────────────────────────────────
// TOKEN REFRESH
// No auth middleware — the httpOnly cookie IS the credential here.
// Returns: { accessToken, user }
// ─────────────────────────────────────────────
router.post('/refresh', refresh);

// ─────────────────────────────────────────────
// GOOGLE OAuth FLOW
// session: false — Passport sets req.user but does NOT touch express-session
// ─────────────────────────────────────────────

// Step 1: Redirect user to Google consent screen
router.get(
  '/google',
  passport.authenticate('google', {
    scope:   ['profile', 'email'],
    session: false,
  })
);

// Step 2: Google redirects back here
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session:         false,
    failureRedirect: `${process.env.CLIENT_URL}/#/signin?error=oauth_failed`,
  }),
  (req, res) => {
    // req.user is set by the GoogleStrategy verify callback
    const { accessToken, refreshToken } = generateTokens(req.user);

    // Refresh token → httpOnly cookie (XSS-safe)
    setRefreshCookie(res, refreshToken);

    // Access token → URL param so the frontend can store it in memory.
    // The /oauth-success React page reads ?at= on mount, stores it, then
    // redirects to /dashboard.
    res.redirect(`${process.env.CLIENT_URL}/#/oauth-success?at=${accessToken}`);
  }
);

// ─────────────────────────────────────────────
// SESSION ROUTES
// ─────────────────────────────────────────────
router.get('/me',     isAuthenticated, getMe);

// Logout only clears the cookie — no valid access token needed.
// The client is responsible for discarding its in-memory access token.
router.post('/logout', logout);

// ─────────────────────────────────────────────
// ROLE ROUTES
// ─────────────────────────────────────────────
router.patch('/role',       isAuthenticated,          upgradeToHost);
router.patch('/admin/role', isAuthenticated, isAdmin, setUserRole);

export default router;
