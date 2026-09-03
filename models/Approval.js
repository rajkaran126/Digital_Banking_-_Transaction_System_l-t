const mongoose = require('mongoose');

// Embed vs Reference: Approval references Account and User (staffId) to maintain an independent, immutable audit log for compliance and accountability.
const approvalSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Account ID is required'],
      index: true
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Staff ID is required'],
      index: true
    },
    decision: {
      type: String,
      required: [true, 'Decision is required'],
      enum: {
        values: ['Approved', 'Rejected', 'approved', 'rejected'],
        message: '{VALUE} is not a valid approval decision'
      }
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
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

approvalSchema.index({ createdAt: -1 });

const Approval = mongoose.model('Approval', approvalSchema);

module.exports = Approval;
