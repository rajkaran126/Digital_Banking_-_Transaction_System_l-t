const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

/**
 * @desc    Register a new user / customer with initial KYC fields
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = catchAsync(async (req, res, next) => {
  const { name, email, password, role, phone, address, idDocumentType, idDocumentNumber } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return next(new AppError('A user with this email address already exists.', 409, 'CONFLICT'));
  }

  // Create user - kycStatus defaults to 'pending'
  const user = await User.create({
    name,
    email,
    passwordHash: password,
    role: role || 'customer',
    kycStatus: 'pending',
    phone,
    address,
    idDocumentType,
    idDocumentNumber
  });

  const token = generateToken(user);

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Initial KYC status set to pending.',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        kycStatus: user.kycStatus,
        phone: user.phone,
        address: user.address,
        idDocumentType: user.idDocumentType,
        idDocumentNumber: user.idDocumentNumber,
        createdAt: user.createdAt
      },
      token
    }
  });
});

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user and explicitly select passwordHash
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  if (!user) {
    return next(new AppError('Invalid email or password.', 401, 'UNAUTHORIZED'));
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return next(new AppError('Invalid email or password.', 401, 'UNAUTHORIZED'));
  }

  const token = generateToken(user);

  res.status(200).json({
    success: true,
    message: 'Logged in successfully.',
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        kycStatus: user.kycStatus
      },
      token
    }
  });
});

module.exports = {
  register,
  login
};
