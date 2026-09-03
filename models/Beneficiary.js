const mongoose = require('mongoose');

// Embed vs Reference: Beneficiary references Account via accountId to allow independent indexing, flexible querying, and prevent unbounded subdocument growth.
const beneficiarySchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      index: true
    },
    beneficiaryAccountNumber: {
      type: String,
      required: [true, 'Beneficiary account number is required'],
      trim: true
    },
    nickname: {
      type: String,
      required: [true, 'Nickname is required'],
      trim: true,
      maxlength: [50, 'Nickname cannot exceed 50 characters']
    }
  },
  {
    timestamps: true,
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

// Compound index for uniqueness of beneficiary under a specific account
beneficiarySchema.index({ accountId: 1, beneficiaryAccountNumber: 1 }, { unique: true });

const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);

module.exports = Beneficiary;
