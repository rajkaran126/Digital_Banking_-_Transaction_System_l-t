const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staff.controller');
const { protect, restrictTo } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// All staff routes require authentication and staff or admin role
router.use(protect);
router.use(restrictTo('staff', 'admin'));

// Foundation: Pending account review queue
router.get('/pending-accounts', staffController.getPendingAccounts);

// ==========================================
// SPRINT 3 - MODULE 9: FLAGGED TRANSACTIONS
// ==========================================
// List flagged transactions (paginated, filtered by accountId, date range)
router.get('/flagged-transactions', staffController.getFlaggedTransactions);

// Review flagged transaction
router.put(
  '/flagged-transactions/:id/review',
  validate(schemas.reviewTransaction),
  staffController.reviewFlaggedTransaction
);

// ==========================================
// SPRINT 3 - MODULE 11: MANUAL INTEREST JOB
// ==========================================
// Manually run interest calculation job (strictly admin only)
router.post(
  '/run-interest-job',
  restrictTo('admin'),
  staffController.runInterestJob
);

// ==========================================
// SPRINT 3 - MODULE 12: STAFF DASHBOARD
// ==========================================
// Executive staff analytics dashboard overview
router.get('/dashboard', staffController.getStaffDashboard);

module.exports = router;
