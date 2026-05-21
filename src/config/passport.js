// backend/src/config/passport.js
//
// JWT auth — only Google OAuth still needs Passport.
// Local (email + password) auth is handled directly in auth.controller.js
// so there is no LocalStrategy here.
// serializeUser / deserializeUser are gone — we use JWT, not server sessions.

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { upsertGoogleUser } from '../models/user.model.js';

// ─────────────────────────────────────────────
// GOOGLE OAuth STRATEGY  (skipped if env vars missing)
// ─────────────────────────────────────────────

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  '/api/auth/google/callback',
      },

      /**
       * Verify callback — runs after Google redirects back with the user profile.
       * Upsert: insert on first login, update name/avatar on repeat logins.
       * google_id, name, email, avatar_url only — no password ever stored.
       */
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const user = await upsertGoogleUser({
            google_id:  profile.id,
            name:       profile.displayName,
            email:      profile.emails[0].value,
            avatar_url: profile.photos[0]?.value ?? null,
          });
          return done(null, user);
        } catch (err) {
          return done(err, null);
        }
      }
    )
  );
} else {
  console.warn('[passport] GOOGLE_CLIENT_ID not set — Google OAuth disabled. Email/password auth still works.');
}

export default passport;
