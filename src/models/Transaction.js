const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    platformFee: { type: Number, required: true },
    sellerPayout: { type: Number, required: true },
    dodoPaymentId: { type: String },
    dodoTransferId: { type: String },
    status: { type: String, enum: ['pending', 'completed', 'refunded'], default: 'pending' }
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false
    }
  }
);

module.exports = mongoose.model('Transaction', transactionSchema);
