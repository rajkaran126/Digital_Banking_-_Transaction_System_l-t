const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staff.controller');
const { protect, restrictTo } = require('../middleware/auth');

// All staff routes require authentication and staff or admin role
router.use(protect);
router.use(restrictTo('staff', 'admin'));

// Implemented staff routes
router.get('/pending-accounts', staffController.getPendingAccounts);

// ==========================================
// STUBS FOR TEAMMATES (MEMBER 3)
// ==========================================
// [STUB - Member 3: Flagged Transactions Review]
router.get('/flagged-transactions', staffController.getFlaggedTransactionsStub);

// [STUB - Member 3: Executive/Staff Dashboard]
router.get('/dashboard', staffController.getStaffDashboardStub);

module.exports = router;
