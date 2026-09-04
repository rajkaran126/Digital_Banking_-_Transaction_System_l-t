const mongoose = require('mongoose');
const Account = require('../models/Account');
const Approval = require('../models/Approval');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { getPagination, formatPaginatedResponse } = require('../utils/pagination');

// Helper to generate unique 10-digit account number
const generateAccountNumber = async (type) => {
  const prefix = type === 'savings' ? '10' : '20';
  let isUnique = false;
  let accountNumber = '';

  while (!isUnique) {
    const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
    accountNumber = `${prefix}${randomDigits.slice(0, 8)}`;
    const existing = await Account.findOne({ accountNumber });
    if (!existing) {
      isUnique = true;
    }
  }
  return accountNumber;
};

/**
 * @desc    Apply for a new bank account (status: 'pending')
 * @route   POST /api/accounts
 * @access  Private (Customer / Authenticated User)
 */
const createAccount = catchAsync(async (req, res, next) => {
  const { type, initialDeposit = 0, dailyTransferLimit = 50000 } = req.body;

  const accountNumber = await generateAccountNumber(type);

  const account = await Account.create({
    userId: req.user._id,
    accountNumber,
    type,
    balance: initialDeposit,
    dailyTransferLimit,
    status: 'pending' // New account applications start in pending status
  });

  res.status(201).json({
    success: true,
    message: 'Bank account application submitted successfully and is pending approval.',
    data: {
      account
    }
  });
});

/**
 * @desc    Get accounts (Customer: own accounts; Staff/Admin: all accounts with pagination)
 * @route   GET /api/accounts
 * @access  Private
 */
const getAccounts = catchAsync(async (req, res, next) => {
  if (req.user.role === 'customer') {
    // Customers only see their own accounts
    const accounts = await Account.find({ userId: req.user._id }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'User accounts retrieved successfully.',
      data: {
        accounts
      }
    });
  }

  // Staff and Admin can view all accounts with pagination and filtering
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.type) {
    filter.type = req.query.type;
  }
  if (req.query.userId) {
    filter.userId = req.query.userId;
  }

  const [accounts, total] = await Promise.all([
    Account.find(filter)
      .populate('userId', 'name email role kycStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Account.countDocuments(filter)
  ]);

  const paginatedResult = formatPaginatedResponse(accounts, total, page, limit);

  res.status(200).json({
    success: true,
    message: 'Accounts retrieved successfully.',
    data: paginatedResult
  });
});

/**
 * @desc    Get account details by ID
 * @route   GET /api/accounts/:id
 * @access  Private (Owner customer or Staff/Admin)
 */
const getAccountById = catchAsync(async (req, res, next) => {
  const account = await Account.findById(req.params.id).populate(
    'userId',
    'name email role kycStatus phone'
  );

  if (!account) {
    return next(new AppError('Account not found.', 404, 'NOT_FOUND'));
  }

  // Ownership verification check: Customers can only access their own accounts
  if (
    req.user.role === 'customer' &&
    account.userId._id.toString() !== req.user._id.toString()
  ) {
    return next(
      new AppError(
        'Access denied. You do not have permission to view this account.',
        403,
        'FORBIDDEN'
      )
    );
  }

  res.status(200).json({
    success: true,
    message: 'Account details retrieved successfully.',
    data: {
      account
    }
  });
});

/**
 * @desc    Approve or reject a pending account application
 * @route   PUT /api/accounts/:id/approve
 * @access  Private (Staff / Admin only)
 */
const approveAccount = catchAsync(async (req, res, next) => {
  const { status, remarks = '' } = req.body;
  const account = await Account.findById(req.params.id);

  if (!account) {
    return next(new AppError('Account not found.', 404, 'NOT_FOUND'));
  }

  // Workflow transition check: only pending accounts can be reviewed
  if (account.status !== 'pending') {
    return next(
      new AppError(
        `Account cannot be processed. Current status is '${account.status}', only 'pending' accounts can be reviewed.`,
        409,
        'CONFLICT'
      )
    );
  }

  const normalizedDecision = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  const isApproved = normalizedDecision === 'Approved';

  // Update account status
  account.status = isApproved ? 'active' : 'rejected';
  await account.save();

  // Create audit trail record in approvals collection
  const approvalRecord = await Approval.create({
    accountId: account._id,
    staffId: req.user._id,
    decision: normalizedDecision,
    remarks
  });

  res.status(200).json({
    success: true,
    message: `Account application has been ${account.status}.`,
    data: {
      account,
      approval: approvalRecord
    }
  });
});

// ==========================================
// SPRINT 2 - TRANSACTIONS & STATEMENTS
// ==========================================

/**
 * @desc    Get paginated account transactions (Module 6 - Ledger)
 * @route   GET /api/accounts/:id/transactions
 * @access  Private (Owner customer or Staff/Admin)
 */
const getAccountTransactions = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError(`Account not found with id: ${id}`, 404, 'NOT_FOUND'));
  }

  const account = await Account.findById(id);
  if (!account) {
    return next(new AppError('Account not found.', 404, 'NOT_FOUND'));
  }

  // Ownership verification check: Customers can only view their own account transactions
  if (req.user.role === 'customer' && account.userId.toString() !== req.user._id.toString()) {
    return next(
      new AppError('Access denied. You do not have permission to view transactions for this account.', 403, 'FORBIDDEN')
    );
  }

  const { page, limit, skip } = getPagination(req.query);

  const [transactions, total] = await Promise.all([
    Transaction.find({ accountId: account._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments({ accountId: account._id })
  ]);

  const paginatedResult = formatPaginatedResponse(transactions, total, page, limit);

  res.status(200).json({
    success: true,
    message: 'Account transactions retrieved successfully.',
    data: paginatedResult
  });
});

/**
 * @desc    Get account statement / transaction history with opening & closing balances
 * @route   GET /api/accounts/:id/statement
 * @access  Private (Owner customer or Staff/Admin)
 */
const getAccountStatement = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError(`Account not found with id: ${id}`, 404, 'NOT_FOUND'));
  }

  const account = await Account.findById(id);
  if (!account) {
    return next(new AppError('Account not found.', 404, 'NOT_FOUND'));
  }

  // Ownership verification check: Customers can only view their own statements
  if (req.user.role === 'customer' && account.userId.toString() !== req.user._id.toString()) {
    return next(
      new AppError('Access denied. You do not have permission to view statement for this account.', 403, 'FORBIDDEN')
    );
  }

  const { from, to } = req.query;

  if (!from || !to) {
    return next(
      new AppError(
        "Both 'from' and 'to' query parameters are required in ISO date format (e.g. YYYY-MM-DD).",
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return next(
      new AppError(
        "Malformed date parameters: 'from' and 'to' must be valid ISO date strings.",
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // If 'to' is just a date like YYYY-MM-DD, set to end of day so transactions on that day are included
  if (typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) {
    toDate.setHours(23, 59, 59, 999);
  }

  if (fromDate > toDate) {
    return next(
      new AppError(
        "'from' date cannot be greater than 'to' date.",
        400,
        'VALIDATION_ERROR'
      )
    );
  }

  // Find all transactions in [fromDate, toDate] ordered chronologically
  const transactions = await Transaction.find({
    accountId: account._id,
    createdAt: { $gte: fromDate, $lte: toDate }
  }).sort({ createdAt: 1 });

  // Compute opening balance
  // 1. Check if there was any transaction before fromDate
  const priorTx = await Transaction.findOne({
    accountId: account._id,
    createdAt: { $lt: fromDate }
  }).sort({ createdAt: -1 });

  let openingBalance;
  if (priorTx) {
    openingBalance = priorTx.balanceAfter;
  } else if (transactions.length > 0) {
    // If no prior tx, compute from first transaction in range
    const firstTx = transactions[0];
    openingBalance = firstTx.type === 'credit'
      ? firstTx.balanceAfter - firstTx.amount
      : firstTx.balanceAfter + firstTx.amount;
  } else {
    // No transactions in range and no transactions before fromDate.
    // Check if there are transactions after toDate
    const laterTx = await Transaction.findOne({
      accountId: account._id,
      createdAt: { $gt: toDate }
    }).sort({ createdAt: 1 });

    if (laterTx) {
      openingBalance = laterTx.type === 'credit'
        ? laterTx.balanceAfter - laterTx.amount
        : laterTx.balanceAfter + laterTx.amount;
    } else {
      openingBalance = account.balance;
    }
  }

  // Compute totals
  let totalDebits = 0;
  let totalCredits = 0;

  for (const tx of transactions) {
    if (tx.type === 'debit') {
      totalDebits += tx.amount;
    } else if (tx.type === 'credit') {
      totalCredits += tx.amount;
    }
  }

  // Compute closing balance
  let closingBalance;
  if (transactions.length > 0) {
    closingBalance = transactions[transactions.length - 1].balanceAfter;
  } else {
    closingBalance = openingBalance;
  }

  const netChange = totalCredits - totalDebits;

  res.status(200).json({
    success: true,
    message: 'Account statement generated successfully.',
    data: {
      account: {
        id: account._id,
        accountNumber: account.accountNumber,
        type: account.type,
        currentBalance: account.balance,
        status: account.status
      },
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString()
      },
      summary: {
        openingBalance,
        closingBalance,
        totalDebits,
        totalCredits,
        netChange,
        transactionCount: transactions.length
      },
      transactions
    }
  });
});

/**
 * Retained stub reference for backwards compatibility
 */
const getStatementStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route GET /api/accounts/:id/statement is a stub to be implemented by Member 2.', 501, 'SERVER_ERROR')
  );
});

// ==========================================
// STUB CONTROLLERS FOR TEAMMATES (MEMBER 3)
// ==========================================

/**
 * @desc    [STUB - Member 3] Freeze account
 * @route   PUT /api/accounts/:id/freeze
 */
const freezeAccountStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route PUT /api/accounts/:id/freeze is a stub to be implemented by Member 3.', 501, 'SERVER_ERROR')
  );
});

/**
 * @desc    [STUB - Member 3] Unfreeze account
 * @route   PUT /api/accounts/:id/unfreeze
 */
const unfreezeAccountStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route PUT /api/accounts/:id/unfreeze is a stub to be implemented by Member 3.', 501, 'SERVER_ERROR')
  );
});

module.exports = {
  createAccount,
  getAccounts,
  getAccountById,
  approveAccount,
  getAccountTransactions,
  getAccountStatement,
  getStatementStub,
  freezeAccountStub,
  unfreezeAccountStub
};
