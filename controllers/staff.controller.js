const Account = require('../models/Account');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');

/**
 * @desc    Get all pending account applications awaiting review
 * @route   GET /api/staff/pending-accounts
 * @access  Private (Staff / Admin only)
 */
const getPendingAccounts = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { status: 'pending' };

  const [accounts, total] = await Promise.all([
    Account.find(filter)
      .populate('userId', 'name email role kycStatus phone address idDocumentType idDocumentNumber createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Account.countDocuments(filter)
  ]);

  const responseData = formatPaginatedResponse(accounts, total, page, limit);

  res.status(200).json({
    success: true,
    message: 'Pending account applications retrieved successfully.',
    data: responseData
  });
});

// ==========================================
// STUB CONTROLLERS FOR TEAMMATES (MEMBER 3)
// ==========================================

/**
 * @desc    [STUB - Member 3] Get flagged suspicious transactions
 * @route   GET /api/staff/flagged-transactions
 */
const getFlaggedTransactionsStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route GET /api/staff/flagged-transactions is a stub to be implemented by Member 3.', 501, 'SERVER_ERROR')
  );
});

/**
 * @desc    [STUB - Member 3] Get staff analytics dashboard overview
 * @route   GET /api/staff/dashboard
 */
const getStaffDashboardStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route GET /api/staff/dashboard is a stub to be implemented by Member 3.', 501, 'SERVER_ERROR')
  );
});

module.exports = {
  getPendingAccounts,
  getFlaggedTransactionsStub,
  getStaffDashboardStub
};
