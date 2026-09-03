const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

/**
 * Protect middleware:
 * Verifies JWT token in Authorization header, extracts user payload,
 * verifies user existence in database, and attaches user to req.user.
 */
const protect = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('You are not logged in. Please provide a valid Bearer token.', 401, 'UNAUTHORIZED')
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(
      new AppError('Invalid or expired authentication token. Please log in again.', 401, 'UNAUTHORIZED')
    );
  }

  const currentUser = await User.findById(decoded.id || decoded.userId);
  if (!currentUser) {
    return next(
      new AppError('The user belonging to this token no longer exists.', 401, 'UNAUTHORIZED')
    );
  }

  // Attach authenticated user to request
  req.user = currentUser;
  next();
});

/**
 * RestrictTo middleware:
 * Enforces Role-Based Access Control (RBAC).
 * Note: Resource-level ownership checks (e.g. customer editing their own account)
 * are handled within respective controllers per architectural convention.
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access forbidden: role '${req.user ? req.user.role : 'unauthenticated'}' lacks required permissions.`,
          403,
          'FORBIDDEN'
        )
      );
    }
    next();
  };
};

module.exports = {
  protect,
  restrictTo
};
