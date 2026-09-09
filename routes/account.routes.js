const express = require('express');
const router = express.Router();
const accountController = require('../controllers/account.controller');
const { protect, restrictTo } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All account routes require authentication
router.use(protect);

// Customer & General Account Routes
router.post('/', validate(schemas.createAccount), accountController.createAccount);
router.get('/', accountController.getAccounts);
router.get('/:id', accountController.getAccountById);

// Staff / Admin Account Review Workflow
router.put(
  '/:id/approve',
  restrictTo('staff', 'admin'),
  validate(schemas.approveAccount),
  accountController.approveAccount
);

// ==========================================
// SPRINT 2 - TRANSACTIONS & STATEMENTS
// ==========================================
// Module 6 - Transaction Ledger (paginated, newest first)
router.get('/:id/transactions', accountController.getAccountTransactions);

// Module 6 - Account Statement Generation
router.get('/:id/statement', accountController.getAccountStatement);

// ==========================================
// SPRINT 3 - ACCOUNT FREEZE & UNFREEZE (MODULE 10)
// ==========================================
router.put(
  '/:id/freeze',
  restrictTo('staff', 'admin'),
  validate(schemas.freezeAccount),
  accountController.freezeAccount
);
router.put(
  '/:id/unfreeze',
  restrictTo('staff', 'admin'),
  accountController.unfreezeAccount
);

module.exports = router;
