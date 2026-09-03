const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');

/**
 * @desc    [STUB - Member 2] Transfer funds between accounts
 * @route   POST /api/transactions/transfer
 * @access  Private (Customer owning source account)
 */
const transferFundsStub = catchAsync(async (req, res, next) => {
  return next(
    new AppError('Route POST /api/transactions/transfer is a stub to be implemented by Member 2.', 501, 'SERVER_ERROR')
  );
});

module.exports = {
  transferFundsStub
};
