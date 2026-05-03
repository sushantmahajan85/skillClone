const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Amount in cents */
    amount: { type: Number, required: true, min: 1 },
    /** Snapshot of bank/payout details at submission time */
    bankDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
