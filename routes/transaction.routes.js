const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transaction.controller');
const { protect } = require('../middleware/auth');

// All transaction routes require authentication
router.use(protect);

// ==========================================
// STUBS FOR TEAMMATES (MEMBER 2)
// ==========================================
// [STUB - Member 2: Fund Transfers & Ledger Processing]
router.post('/transfer', transactionController.transferFundsStub);

module.exports = router;
