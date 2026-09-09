const mongoose = require('mongoose');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');

// Default configurable annual interest rate: 4% (0.04)
const DEFAULT_ANNUAL_INTEREST_RATE = process.env.ANNUAL_INTEREST_RATE
  ? Number(process.env.ANNUAL_INTEREST_RATE)
  : 0.04;

/**
 * Calculate simple interest for active savings accounts for a daily accrual period.
 *
 * Mathematical Assumption & Formula:
 * - Simple Interest: Daily Interest = (balance * annualInterestRate) / 365
 * - Day-count convention: Actual / 365-day denominator
 * - Only accounts where type === 'savings' AND status === 'active' are eligible.
 * - Frozen, pending, closed, or current accounts MUST NOT receive interest.
 * - Zero interest amounts (< 0.01) are skipped to avoid zero-amount ledger entries.
 * - Balance mutation and ledger entry creation reuse the Sprint 2 atomic session pattern.
 *
 * @param {number} [rate] - Configurable annual interest rate (e.g. 0.04 for 4%)
 * @returns {Promise<{ accountsProcessed: number, accountsCredited: number, totalInterestCredited: number }>}
 */
const calculateInterestForSavingsAccounts = async (rate) => {
  const annualInterestRate = typeof rate === 'number' && rate >= 0
    ? rate
    : DEFAULT_ANNUAL_INTEREST_RATE;

  // 1. Query all eligible accounts: strictly active savings accounts
  const eligibleAccounts = await Account.find({
    type: 'savings',
    status: 'active'
  });

  let accountsProcessed = eligibleAccounts.length;
  let accountsCredited = 0;
  let totalInterestCredited = 0;

  for (const account of eligibleAccounts) {
    // 2. Calculate daily interest amount
    const rawInterest = (account.balance * annualInterestRate) / 365;
    const interestAmount = Math.round((rawInterest + Number.EPSILON) * 100) / 100;

    // 3. Skip zero interest or accounts with zero balance
    if (interestAmount <= 0) {
      continue;
    }

    // 4. Replicate Sprint 2 atomic session pattern with standalone fallback
    const session = await mongoose.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          // Re-fetch under session for consistency
          const accInSession = await Account.findById(account._id).session(session);

          if (!accInSession || accInSession.type !== 'savings' || accInSession.status !== 'active') {
            return;
          }

          const newBalance = Math.round((accInSession.balance + interestAmount + Number.EPSILON) * 100) / 100;
          accInSession.balance = newBalance;
          await accInSession.save({ session });

          // Create ledger credit record in the same atomic session
          await Transaction.create(
            [
              {
                accountId: accInSession._id,
                type: 'credit',
                amount: interestAmount,
                balanceAfter: newBalance,
                relatedAccount: null,
                description: 'Daily interest credit',
                flagged: false
              }
            ],
            { session }
          );

          accountsCredited++;
          totalInterestCredited += interestAmount;
        });
      } catch (txnError) {
        // Fallback for standalone MongoDB environments without replica set
        if (txnError.message && txnError.message.includes('replica set member or mongos')) {
          const accStandalone = await Account.findById(account._id);

          if (accStandalone && accStandalone.type === 'savings' && accStandalone.status === 'active') {
            const newBalance = Math.round((accStandalone.balance + interestAmount + Number.EPSILON) * 100) / 100;
            accStandalone.balance = newBalance;
            await accStandalone.save();

            await Transaction.create({
              accountId: accStandalone._id,
              type: 'credit',
              amount: interestAmount,
              balanceAfter: newBalance,
              relatedAccount: null,
              description: 'Daily interest credit',
              flagged: false
            });

            accountsCredited++;
            totalInterestCredited += interestAmount;
          }
        } else {
          throw txnError;
        }
      }
    } finally {
      await session.endSession();
    }
  }

  return {
    accountsProcessed,
    accountsCredited,
    totalInterestCredited: Math.round((totalInterestCredited + Number.EPSILON) * 100) / 100
  };
};

module.exports = {
  calculateInterestForSavingsAccounts,
  DEFAULT_ANNUAL_INTEREST_RATE
};
