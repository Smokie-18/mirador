// backend/src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';   // parses req.cookies — needed for refresh token
import passport from 'passport';
import dotenv from 'dotenv';

import './config/passport.js';              // registers Google OAuth strategy
import authRoutes    from './routes/auth.routes.js';
import hotelRoutes   from './routes/hotel.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import reviewRoutes  from './routes/review.routes.js';
import { errorHandler } from './middlewares/error.middleware.js';

dotenv.config();

const app = express();

// Trust Render/Railway/etc reverse proxy so req.protocol === 'https'
// and Passport builds the correct callback URL for Google OAuth.
app.set('trust proxy', 1);

// ── Middleware stack ──────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin:      process.env.CLIENT_URL,
  credentials: true,           // allows the refresh token cookie to be sent cross-origin
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());       // must come before routes so req.cookies is populated

// Passport is only needed for the Google OAuth redirect flow.
// We no longer use passport.session() — auth state lives in JWTs.
app.use(passport.initialize());

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/hotels',   hotelRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews',  reviewRoutes);

// ── Error handler (must be last) ─────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});