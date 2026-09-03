const Beneficiary = require('../models/Beneficiary');
const Account = require('../models/Account');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

/**
 * @desc    Add a beneficiary to an account
 * @route   POST /api/beneficiaries
 * @access  Private (Customer owning the source account)
 */
const addBeneficiary = catchAsync(async (req, res, next) => {
  const { accountId, beneficiaryAccountNumber, nickname } = req.body;

  // 1. Verify source account exists
  const sourceAccount = await Account.findById(accountId);
  if (!sourceAccount) {
    return next(new AppError('Source account not found.', 404, 'NOT_FOUND'));
  }

  // 2. Ownership verification: Customer can only add beneficiaries to their own accounts
  if (
    req.user.role === 'customer' &&
    sourceAccount.userId.toString() !== req.user._id.toString()
  ) {
    return next(
      new AppError(
        'Access denied. You do not own the source account.',
        403,
        'FORBIDDEN'
      )
    );
  }

  // 3. Prevent adding own account as beneficiary
  if (sourceAccount.accountNumber === beneficiaryAccountNumber) {
    return next(
      new AppError(
        'Cannot add the source account itself as a beneficiary.',
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // 4. Validate that destination beneficiary account exists and is currently active
  const targetAccount = await Account.findOne({
    accountNumber: beneficiaryAccountNumber,
    status: 'active'
  });

  if (!targetAccount) {
    return next(
      new AppError(
        'Beneficiary account number does not exist or is not currently active.',
        404,
        'NOT_FOUND'
      )
    );
  }

  // 5. Check if beneficiary is already added for this account
  const existingBeneficiary = await Beneficiary.findOne({
    accountId,
    beneficiaryAccountNumber
  });

  if (existingBeneficiary) {
    return next(
      new AppError(
        'This beneficiary account is already registered under the selected account.',
        409,
        'CONFLICT'
      )
    );
  }

  // 6. Create beneficiary
  const beneficiary = await Beneficiary.create({
    accountId,
    beneficiaryAccountNumber,
    nickname
  });

  res.status(201).json({
    success: true,
    message: 'Beneficiary added successfully.',
    data: {
      beneficiary
    }
  });
});

/**
 * @desc    Get beneficiaries
 * @route   GET /api/beneficiaries
 * @access  Private
 */
const getBeneficiaries = catchAsync(async (req, res, next) => {
  const { accountId } = req.query;

  if (accountId) {
    // Verify source account exists and check permissions
    const account = await Account.findById(accountId);
    if (!account) {
      return next(new AppError('Account not found.', 404, 'NOT_FOUND'));
    }

    if (
      req.user.role === 'customer' &&
      account.userId.toString() !== req.user._id.toString()
    ) {
      return next(
        new AppError(
          'Access denied. You do not own this account.',
          403,
          'FORBIDDEN'
        )
      );
    }

    const beneficiaries = await Beneficiary.find({ accountId }).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      message: 'Beneficiaries retrieved successfully.',
      data: {
        beneficiaries
      }
    });
  }

  // If no accountId provided, fetch for all accounts owned by the user
  if (req.user.role === 'customer') {
    const userAccounts = await Account.find({ userId: req.user._id }).select('_id');
    const accountIds = userAccounts.map((acc) => acc._id);

    const beneficiaries = await Beneficiary.find({ accountId: { $in: accountIds } })
      .populate('accountId', 'accountNumber type status')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'User beneficiaries retrieved successfully.',
      data: {
        beneficiaries
      }
    });
  }

  // Staff and Admin can view all beneficiaries
  const beneficiaries = await Beneficiary.find()
    .populate('accountId', 'accountNumber type status userId')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    message: 'All beneficiaries retrieved successfully.',
    data: {
      beneficiaries
    }
  });
});

/**
 * @desc    Delete a beneficiary
 * @route   DELETE /api/beneficiaries/:id
 * @access  Private (Owner of parent account or Staff/Admin)
 */
const deleteBeneficiary = catchAsync(async (req, res, next) => {
  const beneficiary = await Beneficiary.findById(req.params.id);

  if (!beneficiary) {
    return next(new AppError('Beneficiary not found.', 404, 'NOT_FOUND'));
  }

  // Check parent account ownership
  const parentAccount = await Account.findById(beneficiary.accountId);
  if (
    req.user.role === 'customer' &&
    (!parentAccount || parentAccount.userId.toString() !== req.user._id.toString())
  ) {
    return next(
      new AppError(
        'Access denied. You do not have permission to delete this beneficiary.',
        403,
        'FORBIDDEN'
      )
    );
  }

  await Beneficiary.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Beneficiary removed successfully.',
    data: null
  });
});

module.exports = {
  addBeneficiary,
  getBeneficiaries,
  deleteBeneficiary
};
