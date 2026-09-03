const AppError = require('../utils/appError');

/**
 * Centralized error-handling middleware.
 * Guarantees uniform response contract across the entire application:
 * {
 *   "success": false,
 *   "message": "...",
 *   "errorCode": "VALIDATION_ERROR" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "SERVER_ERROR"
 * }
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.statusCode = err.statusCode || 500;
  error.errorCode = err.errorCode || 'SERVER_ERROR';

  // Handle Mongoose CastError (e.g. Invalid ObjectId)
  if (err.name === 'CastError') {
    error = new AppError(`Resource not found with id: ${err.value}`, 404, 'NOT_FOUND');
  }

  // Handle Mongoose Duplicate Key Error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const val = err.keyValue ? err.keyValue[field] : '';
    error = new AppError(
      `Duplicate value entered for ${field} '${val}'. Please use another value.`,
      409,
      'CONFLICT'
    );
  }

  // Handle Mongoose Schema Validation Error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join('; ');
    error = new AppError(message, 400, 'VALIDATION_ERROR');
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token. Please log in again.', 401, 'UNAUTHORIZED');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Your token has expired. Please log in again.', 401, 'UNAUTHORIZED');
  }

  // Ensure status code matches error classification
  const statusCode = error.statusCode || 500;
  const errorCode = error.errorCode || 'SERVER_ERROR';
  const message = error.message || 'An unexpected internal server error occurred.';

  if (process.env.NODE_ENV === 'development' && statusCode === 500) {
    console.error('Unhandled Server Error:', err);
  }

  return res.status(statusCode).json({
    success: false,
    message: message,
    errorCode: errorCode
  });
};

module.exports = errorHandler;
