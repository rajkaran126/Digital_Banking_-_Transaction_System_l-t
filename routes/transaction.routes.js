const express = require('express');
const router = express.Router();
const Joi = require('joi');
const transactionController = require('../controllers/transaction.controller');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

// All transaction routes require authentication
router.use(protect);

// Joi schema for fund transfer
const transferSchema = Joi.object({
  fromAccountId: Joi.string().trim().optional(),
  sourceAccountId: Joi.string().trim().optional(),
  toAccountNumber: Joi.string().trim().optional(),
  destinationAccountNumber: Joi.string().trim().optional(),
  amount: Joi.number().positive().required().messages({
    'number.base': 'amount must be a number',
    'number.positive': 'amount must be greater than 0',
    'any.required': 'amount is required'
  }),
  description: Joi.string().trim().max(200).allow('', null).optional()
}).custom((value, helpers) => {
  const fromId = value.fromAccountId || value.sourceAccountId;
  if (!fromId) {
    return helpers.message('fromAccountId is required');
  }
  const toNum = value.toAccountNumber || value.destinationAccountNumber;
  if (!toNum) {
    return helpers.message('toAccountNumber is required');
  }
  value.fromAccountId = fromId;
  value.toAccountNumber = toNum;
  return value;
});

// ==========================================
// SPRINT 2 - FUND TRANSFERS & LEDGER
// ==========================================
// Fund Transfer (Module 5 & Module 8)
router.post('/transfer', validate(transferSchema), transactionController.transferFunds);

module.exports = router;
