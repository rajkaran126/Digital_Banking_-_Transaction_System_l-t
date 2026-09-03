const mongoose = require('mongoose');

// Embed vs Reference: Account references User via userId because a customer can own multiple accounts whose balance and lifecycle fluctuate independently.
const accountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required'],
      unique: true,
      trim: true
    },
    type: {
      type: String,
      required: [true, 'Account type is required'],
      enum: {
        values: ['savings', 'current'],
        message: '{VALUE} is not a valid account type'
      }
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance cannot be negative']
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'active', 'frozen', 'closed', 'rejected'],
        message: '{VALUE} is not a valid account status'
      },
      default: 'pending',
      index: true
    },
    dailyTransferLimit: {
      type: Number,
      default: 50000,
      min: [0, 'Daily transfer limit cannot be negative']
    },
    minimumBalance: {
      type: Number,
      default: function () {
        return this.type === 'current' ? 5000 : 1000;
      },
      min: [0, 'Minimum balance cannot be negative']
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

const Account = mongoose.model('Account', accountSchema);

module.exports = Account;
