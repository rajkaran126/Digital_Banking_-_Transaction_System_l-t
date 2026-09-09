const mongoose = require('mongoose');

// Embed vs Reference: Transaction references Account via accountId because financial ledgers are high-volume, append-only streams that would violate document size limits if embedded.
const transactionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      index: true
    },
    type: {
      type: String,
      required: [true, 'Transaction type is required'],
      enum: {
        values: ['debit', 'credit'],
        message: '{VALUE} is not a valid transaction type'
      }
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Transaction amount must be greater than 0']
    },
    balanceAfter: {
      type: Number,
      required: [true, 'Balance after transaction is required'],
      min: [0, 'Balance after transaction cannot be negative']
    },
    relatedAccount: {
      type: String,
      trim: true,
      default: null
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    flagged: {
      type: Boolean,
      default: false,
      index: true
    },
    reviewed: {
      type: Boolean,
      default: false,
      index: true
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewNote: {
      type: String,
      trim: true,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true // Ledger records are permanent and never modified
    }
  },
  {
    timestamps: false, // No updatedAt needed since transactions are immutable ledger entries
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    },
    toObject: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound index for querying account ledger in reverse chronological order
transactionSchema.index({ accountId: 1, createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
