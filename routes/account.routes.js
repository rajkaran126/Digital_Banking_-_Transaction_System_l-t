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
// STUBS FOR TEAMMATES
// ==========================================
// [STUB - Member 2: Transactions & Statements]
router.get('/:id/statement', accountController.getStatementStub);

// [STUB - Member 3: Account Controls]
router.put('/:id/freeze', restrictTo('staff', 'admin'), accountController.freezeAccountStub);
router.put('/:id/unfreeze', restrictTo('staff', 'admin'), accountController.unfreezeAccountStub);

module.exports = router;
