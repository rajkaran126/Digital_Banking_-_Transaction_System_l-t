const User = require('../models/User');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

/**
 * @desc    Get current authenticated user profile and KYC details
 * @route   GET /api/users/me
 * @access  Private
 */
const getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  res.status(200).json({
    success: true,
    message: 'User profile retrieved successfully.',
    data: {
      user
    }
  });
});

/**
 * @desc    Update user profile / KYC fields
 * @route   PUT /api/users/me
 * @access  Private (Editable only while kycStatus is 'pending' for customers)
 */
const updateMe = catchAsync(async (req, res, next) => {
  const currentUser = await User.findById(req.user._id);

  if (!currentUser) {
    return next(new AppError('User not found.', 404, 'NOT_FOUND'));
  }

  // Business Rule: Lock KYC fields once approved for customers
  if (currentUser.role === 'customer' && currentUser.kycStatus === 'approved') {
    return next(
      new AppError(
        'KYC profile is already approved and locked from further modification.',
        409,
        'CONFLICT'
      )
    );
  }

  const { name, phone, address, idDocumentType, idDocumentNumber } = req.body;

  if (name !== undefined) currentUser.name = name;
  if (phone !== undefined) currentUser.phone = phone;
  if (address !== undefined) {
    currentUser.address = {
      ...currentUser.address?.toObject?.() || currentUser.address,
      ...address
    };
  }
  if (idDocumentType !== undefined) currentUser.idDocumentType = idDocumentType;
  if (idDocumentNumber !== undefined) currentUser.idDocumentNumber = idDocumentNumber;

  // If KYC was previously rejected and customer updates details, reset status to pending for re-review
  if (currentUser.kycStatus === 'rejected') {
    currentUser.kycStatus = 'pending';
  }

  await currentUser.save();

  res.status(200).json({
    success: true,
    message: 'Profile and KYC details updated successfully.',
    data: {
      user: currentUser
    }
  });
});

module.exports = {
  getMe,
  updateMe
};
