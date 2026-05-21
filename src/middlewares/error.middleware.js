// backend/src/middlewares/error.middleware.js

// PostgreSQL error codes → clean HTTP responses
// Never leak raw PG messages (they contain table/constraint names) to the client
const PG_ERROR_MAP = {
  '23P01': { status: 409, message: 'Booking conflict — those dates are no longer available' },
  '23503': { status: 409, message: 'Cannot complete action — a related resource is still in use' },
  '23505': { status: 409, message: 'Duplicate entry — this record already exists' },
  '22P02': { status: 400, message: 'Invalid input format' },
  '42703': { status: 400, message: 'Invalid field in request' },
};

export const errorHandler = (err, req, res, next) => {
  // Known PostgreSQL errors — map to clean user-facing messages
  if (err.code && PG_ERROR_MAP[err.code]) {
    const { status, message } = PG_ERROR_MAP[err.code];
    return res.status(status).json({ success: false, message });
  }

  const statusCode = err.statusCode || 500;
  const message    = statusCode === 500
    ? 'Internal Server Error'   // never expose raw 500 messages in production
    : err.message;

  return res.status(statusCode).json({
    success: false,
    message,
    // Stack trace in dev only — never in production
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};