const mongoose = require('mongoose');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');
const { calculateInterestForSavingsAccounts } = require('../services/interest.service');

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
// SPRINT 3 - MODULE 9: FLAGGED TRANSACTIONS
// ==========================================

/**
 * @desc    Get flagged suspicious transactions (Module 9)
 * @route   GET /api/staff/flagged-transactions
 * @access  Private (Staff / Admin only)
 */
const getFlaggedTransactions = catchAsync(async (req, res, next) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { flagged: true };

  // Filter by accountId if provided
  if (req.query.accountId) {
    if (!mongoose.Types.ObjectId.isValid(req.query.accountId)) {
      return next(new AppError('Invalid accountId filter parameter.', 400, 'VALIDATION_ERROR'));
    }
    filter.accountId = req.query.accountId;
  }

  // Filter by date range if provided
  if (req.query.startDate || req.query.endDate) {
    filter.createdAt = {};

    if (req.query.startDate) {
      const sDate = new Date(req.query.startDate);
      if (isNaN(sDate.getTime())) {
        return next(new AppError("Malformed date parameter: 'startDate' must be a valid date string.", 400, 'VALIDATION_ERROR'));
      }
      filter.createdAt.$gte = sDate;
    }

    if (req.query.endDate) {
      const eDate = new Date(req.query.endDate);
      if (isNaN(eDate.getTime())) {
        return next(new AppError("Malformed date parameter: 'endDate' must be a valid date string.", 400, 'VALIDATION_ERROR'));
      }
      // If date only (e.g. YYYY-MM-DD), set to end of day to include transactions on that date
      if (typeof req.query.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate.trim())) {
        eDate.setHours(23, 59, 59, 999);
      }
      filter.createdAt.$lte = eDate;
    }

    if (filter.createdAt.$gte && filter.createdAt.$lte && filter.createdAt.$gte > filter.createdAt.$lte) {
      return next(new AppError("'startDate' cannot be greater than 'endDate'.", 400, 'VALIDATION_ERROR'));
    }
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate('accountId', 'accountNumber type status userId')
      .populate('reviewedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments(filter)
  ]);

  const responseData = formatPaginatedResponse(transactions, total, page, limit);

  res.status(200).json({
    success: true,
    message: 'Flagged transactions retrieved successfully.',
    data: responseData
  });
});

/**
 * @desc    Review a flagged suspicious transaction (Module 9)
 * @route   PUT /api/staff/flagged-transactions/:id/review
 * @access  Private (Staff / Admin only)
 */
const reviewFlaggedTransaction = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError(`Transaction not found with id: ${id}`, 404, 'NOT_FOUND'));
  }

  const transaction = await Transaction.findById(id);
  if (!transaction) {
    return next(new AppError('Transaction not found.', 404, 'NOT_FOUND'));
  }

  // Ensure transaction is flagged as suspicious
  if (!transaction.flagged) {
    return next(
      new AppError('Transaction is not flagged as suspicious and cannot be reviewed.', 409, 'CONFLICT')
    );
  }

  const remarks = req.body && req.body.remarks ? req.body.remarks.trim() : '';
  if (!remarks) {
    return next(new AppError('Review remarks are required.', 400, 'VALIDATION_ERROR'));
  }

  transaction.reviewed = true;
  transaction.reviewedBy = req.user._id;
  transaction.reviewNote = remarks;
  await transaction.save();

  await transaction.populate([
    { path: 'accountId', select: 'accountNumber type status userId' },
    { path: 'reviewedBy', select: 'name email role' }
  ]);

  res.status(200).json({
    success: true,
    message: 'Flagged transaction reviewed successfully.',
    data: {
      transaction
    }
  });
});

// ==========================================
// SPRINT 3 - MODULE 11: MANUAL INTEREST JOB
// ==========================================

/**
 * @desc    Manually run interest calculation job for active savings accounts (Module 11)
 * @route   POST /api/staff/run-interest-job
 * @access  Private (Admin only)
 */
const runInterestJob = catchAsync(async (req, res, next) => {
  const summary = await calculateInterestForSavingsAccounts();

  res.status(200).json({
    success: true,
    message: 'Interest calculation job completed successfully.',
    data: {
      summary
    }
  });
});

// ==========================================
// SPRINT 3 - MODULE 12: STAFF DASHBOARD
// ==========================================

/**
 * @desc    Get staff analytics dashboard overview with aggregation (Module 12)
 * @route   GET /api/staff/dashboard
 * @access  Private (Staff / Admin only)
 */
const getStaffDashboard = catchAsync(async (req, res, next) => {
  // Use parallel MongoDB aggregations ($facet) for optimal performance
  const [accountStats, transactionStats] = await Promise.all([
    Account.aggregate([
      {
        $facet: {
          pendingCount: [
            { $match: { status: 'pending' } },
            { $count: 'count' }
          ],
          frozenCount: [
            { $match: { status: 'frozen' } },
            { $count: 'count' }
          ]
        }
      }
    ]),
    Transaction.aggregate([
      {
        $facet: {
          unreviewedFlaggedCount: [
            { $match: { flagged: true, reviewed: false } },
            { $count: 'count' }
          ],
          recentTransactions: [
            { $sort: { createdAt: -1 } },
            { $limit: 10 }
          ]
        }
      }
    ])
  ]);

  const pendingAccountApprovals = accountStats[0]?.pendingCount[0]?.count || 0;
  const frozenAccounts = accountStats[0]?.frozenCount[0]?.count || 0;
  const unreviewedFlaggedTransactions = transactionStats[0]?.unreviewedFlaggedCount[0]?.count || 0;
  const recentTransactions = transactionStats[0]?.recentTransactions || [];

  res.status(200).json({
    success: true,
    message: 'Staff dashboard overview retrieved successfully.',
    data: {
      pendingAccountApprovals,
      unreviewedFlaggedTransactions,
      frozenAccounts,
      recentTransactions
    }
  });
});

/**
 * Backwards compatibility stubs
 */
const getFlaggedTransactionsStub = getFlaggedTransactions;
const getStaffDashboardStub = getStaffDashboard;

module.exports = {
  getPendingAccounts,
  getFlaggedTransactions,
  reviewFlaggedTransaction,
  runInterestJob,
  getStaffDashboard,
  getFlaggedTransactionsStub,
  getStaffDashboardStub
};
