const mongoose = require('mongoose');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

// Configurable suspicious activity threshold (default: 10,000)
const SUSPICIOUS_TRANSACTION_THRESHOLD = process.env.SUSPICIOUS_TRANSACTION_THRESHOLD
  ? Number(process.env.SUSPICIOUS_TRANSACTION_THRESHOLD)
  : 10000;

/**
 * @desc    Transfer funds between accounts (Module 5 & Module 8)
 * @route   POST /api/transactions/transfer
 * @access  Private (Customer owning source account)
 */
const transferFunds = catchAsync(async (req, res, next) => {
  const fromAccountId = req.body.fromAccountId || req.body.sourceAccountId;
  const toAccountNumber = req.body.toAccountNumber || req.body.destinationAccountNumber;
  const { amount, description = '' } = req.body;

  // 1. Validate required fields
  if (!fromAccountId) {
    return next(new AppError('fromAccountId is required.', 400, 'VALIDATION_ERROR'));
  }
  if (!toAccountNumber) {
    return next(new AppError('toAccountNumber is required.', 400, 'VALIDATION_ERROR'));
  }

  // 2. Validate valid ObjectId format for source account
  if (!mongoose.Types.ObjectId.isValid(fromAccountId)) {
    return next(new AppError(`Source account not found with id: ${fromAccountId}`, 404, 'NOT_FOUND'));
  }

  // 3. Validate positive amount
  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return next(new AppError('Transaction amount must be greater than 0.', 400, 'VALIDATION_ERROR'));
  }

  // 4. Retrieve source account and verify existence
  const fromAccount = await Account.findById(fromAccountId);
  if (!fromAccount) {
    return next(new AppError(`Source account not found with id: ${fromAccountId}`, 404, 'NOT_FOUND'));
  }

  // 5. Ownership verification: Caller must own the source account
  if (fromAccount.userId.toString() !== req.user._id.toString()) {
    return next(
      new AppError('Access denied. You do not have permission to initiate transfers from this account.', 403, 'FORBIDDEN')
    );
  }

  // 6. Retrieve destination account and verify existence
  const toAccount = await Account.findOne({ accountNumber: String(toAccountNumber).trim() });
  if (!toAccount) {
    return next(
      new AppError(`Destination account with number '${toAccountNumber}' not found.`, 404, 'NOT_FOUND')
    );
  }

  // 7. Prevent transferring to the exact same account
  if (fromAccount._id.toString() === toAccount._id.toString() || fromAccount.accountNumber === toAccount.accountNumber) {
    return next(new AppError('Cannot transfer funds to the same account.', 400, 'VALIDATION_ERROR'));
  }

  // 8. Enforce active account status on both accounts (409 CONFLICT if pending, frozen, or closed)
  if (fromAccount.status !== 'active') {
    return next(
      new AppError(
        `Source account cannot execute transfers. Current status is '${fromAccount.status}'. Only active accounts can initiate transfers.`,
        409,
        'CONFLICT'
      )
    );
  }

  if (toAccount.status !== 'active') {
    return next(
      new AppError(
        `Destination account cannot receive transfers. Current status is '${toAccount.status}'. Transfers can only be made to active accounts.`,
        409,
        'CONFLICT'
      )
    );
  }

  // 9. Balance & Minimum Balance Validation (Module 8)
  // Must reject with 409 + VALIDATION_ERROR per project specification
  if (fromAccount.balance < parsedAmount) {
    return next(
      new AppError(
        `Insufficient funds. Current balance is ${fromAccount.balance}, but transfer amount is ${parsedAmount}.`,
        409,
        'VALIDATION_ERROR'
      )
    );
  }

  const postTransferBalance = fromAccount.balance - parsedAmount;
  const minRequiredBalance = typeof fromAccount.minimumBalance === 'number'
    ? fromAccount.minimumBalance
    : (fromAccount.type === 'current' ? 5000 : 1000);

  if (postTransferBalance < minRequiredBalance) {
    return next(
      new AppError(
        `Transfer rejected: post-transfer balance (${postTransferBalance}) would breach the account's required minimum balance (${minRequiredBalance}).`,
        409,
        'VALIDATION_ERROR'
      )
    );
  }

  // 10. Enforce Daily Transfer Limit
  // Sum today's debit transactions for the source account
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayDebits = await Transaction.aggregate([
    {
      $match: {
        accountId: fromAccount._id,
        type: 'debit',
        createdAt: { $gte: startOfDay }
      }
    },
    {
      $group: {
        _id: null,
        totalDebited: { $sum: '$amount' }
      }
    }
  ]);

  const totalDebitedToday = todayDebits.length > 0 ? todayDebits[0].totalDebited : 0;
  const dailyLimit = typeof fromAccount.dailyTransferLimit === 'number' ? fromAccount.dailyTransferLimit : 50000;

  if (totalDebitedToday + parsedAmount > dailyLimit) {
    return next(
      new AppError(
        `Transfer rejected: daily transfer limit of ${dailyLimit} exceeded. Total transfers today: ${totalDebitedToday}, requested: ${parsedAmount}.`,
        409,
        'VALIDATION_ERROR'
      )
    );
  }

  // 11. Suspicious Activity Threshold Check (Feeds Module 9 compliance review)
  const isFlagged = parsedAmount > SUSPICIOUS_TRANSACTION_THRESHOLD;

  // 12. Atomic Update via Mongoose Session & Transaction (session.withTransaction)
  const session = await mongoose.startSession();
  let debitRecord;
  let creditRecord;
  let updatedSource;
  let updatedDest;

  try {
    try {
      await session.withTransaction(async () => {
        // Re-fetch inside session to guarantee write locks & latest state
        const sourceInSession = await Account.findById(fromAccount._id).session(session);
        const destInSession = await Account.findById(toAccount._id).session(session);

        if (!sourceInSession || !destInSession) {
          throw new AppError('One or both accounts could not be verified during transaction processing.', 404, 'NOT_FOUND');
        }

        if (sourceInSession.status !== 'active' || destInSession.status !== 'active') {
          throw new AppError('Account status changed during processing; transfer aborted.', 409, 'CONFLICT');
        }

        if (sourceInSession.balance < parsedAmount) {
          throw new AppError('Insufficient funds available during atomic transfer execution.', 409, 'VALIDATION_ERROR');
        }

        const newSourceBalance = sourceInSession.balance - parsedAmount;
        const newDestBalance = destInSession.balance + parsedAmount;

        if (newSourceBalance < minRequiredBalance) {
          throw new AppError('Transfer would breach minimum balance requirement.', 409, 'VALIDATION_ERROR');
        }

        // Update account balances
        sourceInSession.balance = newSourceBalance;
        destInSession.balance = newDestBalance;

        await sourceInSession.save({ session });
        await destInSession.save({ session });

        const debitDesc = description && description.trim()
          ? description.trim()
          : `Transfer to account ${destInSession.accountNumber}`;

        const creditDesc = description && description.trim()
          ? description.trim()
          : `Transfer from account ${sourceInSession.accountNumber}`;

        // Write TWO transaction ledger documents in the same atomic session
        const createdDebits = await Transaction.create(
          [
            {
              accountId: sourceInSession._id,
              type: 'debit',
              amount: parsedAmount,
              balanceAfter: newSourceBalance,
              relatedAccount: destInSession.accountNumber,
              description: debitDesc,
              flagged: isFlagged
            }
          ],
          { session }
        );
        debitRecord = createdDebits[0];

        const createdCredits = await Transaction.create(
          [
            {
              accountId: destInSession._id,
              type: 'credit',
              amount: parsedAmount,
              balanceAfter: newDestBalance,
              relatedAccount: sourceInSession.accountNumber,
              description: creditDesc,
              flagged: isFlagged
            }
          ],
          { session }
        );
        creditRecord = createdCredits[0];

        updatedSource = sourceInSession;
        updatedDest = destInSession;
      });
    } catch (txnError) {
      // Fallback for standalone MongoDB environments (e.g. development without replica set)
      if (txnError.message && txnError.message.includes('replica set member or mongos')) {
        const sourceAcc = await Account.findById(fromAccount._id);
        const destAcc = await Account.findById(toAccount._id);

        if (sourceAcc.balance < parsedAmount) {
          throw new AppError('Insufficient funds available during transfer execution.', 409, 'VALIDATION_ERROR');
        }

        const newSourceBal = sourceAcc.balance - parsedAmount;
        const newDestBal = destAcc.balance + parsedAmount;

        if (newSourceBal < minRequiredBalance) {
          throw new AppError('Transfer would breach minimum balance requirement.', 409, 'VALIDATION_ERROR');
        }

        sourceAcc.balance = newSourceBal;
        await sourceAcc.save();

        try {
          destAcc.balance = newDestBal;
          await destAcc.save();

          const debitDesc = description && description.trim()
            ? description.trim()
            : `Transfer to account ${destAcc.accountNumber}`;

          const creditDesc = description && description.trim()
            ? description.trim()
            : `Transfer from account ${sourceAcc.accountNumber}`;

          debitRecord = await Transaction.create({
            accountId: sourceAcc._id,
            type: 'debit',
            amount: parsedAmount,
            balanceAfter: newSourceBal,
            relatedAccount: destAcc.accountNumber,
            description: debitDesc,
            flagged: isFlagged
          });

          creditRecord = await Transaction.create({
            accountId: destAcc._id,
            type: 'credit',
            amount: parsedAmount,
            balanceAfter: newDestBal,
            relatedAccount: sourceAcc.accountNumber,
            description: creditDesc,
            flagged: isFlagged
          });

          updatedSource = sourceAcc;
          updatedDest = destAcc;
        } catch (compensationError) {
          // Manual compensation rollback if step fails in standalone mode
          sourceAcc.balance = sourceAcc.balance + parsedAmount;
          await sourceAcc.save();
          throw compensationError;
        }
      } else {
        throw txnError;
      }
    }
  } finally {
    await session.endSession();
  }

  res.status(200).json({
    success: true,
    message: 'Fund transfer completed successfully.',
    data: {
      transfer: {
        fromAccountId: updatedSource._id,
        fromAccountNumber: updatedSource.accountNumber,
        toAccountId: updatedDest._id,
        toAccountNumber: updatedDest.accountNumber,
        amount: parsedAmount,
        sourceBalanceAfter: updatedSource.balance,
        flagged: isFlagged
      },
      debitTransaction: debitRecord,
      creditTransaction: creditRecord
    }
  });
});

/**
 * Retained stub reference for backwards compatibility
 */
const transferFundsStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route POST /api/transactions/transfer is a stub to be implemented by Member 2.', 501, 'SERVER_ERROR')
  );
});

module.exports = {
  transferFunds,
  transferFundsStub,
  SUSPICIOUS_TRANSACTION_THRESHOLD
};
