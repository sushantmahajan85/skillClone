const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    /** 'purchase' = buyer → seller sale; 'withdrawal' = seller cashing out */
    type: {
      type: String,
      enum: ['purchase', 'withdrawal'],
      default: 'purchase',
      index: true
    },
    // ── Purchase-only fields (undefined for withdrawals) ──────────────────
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    buyerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    platformFee:   { type: Number },
    sellerPayout:  { type: Number },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true },
    razorpaySignature: { type: String },
    // ── Withdrawal-only fields (undefined for purchases) ──────────────────
    /** Snapshot of payout/bank details provided at withdrawal time */
    bankDetails: { type: mongoose.Schema.Types.Mixed },
    // ── Shared fields ─────────────────────────────────────────────────────
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Amount in cents */
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'refunded', 'failed'],
      default: 'pending',
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

module.exports = mongoose.model('Transaction', transactionSchema);
