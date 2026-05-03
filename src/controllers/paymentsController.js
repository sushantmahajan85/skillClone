const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const dodoPayments = require('../config/dodopayments');

const createCheckout = async (req, res, next) => {
  try {
    if (!['buyer', 'both'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Only buyers can create checkout sessions' });
    }

    const { listingId } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing || listing.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Listing not found or unavailable' });
    }

    const seller = await User.findById(listing.sellerId);
    if (!seller || !seller.dodopaymentsMerchantId) {
      return res.status(400).json({ success: false, message: 'Seller is not ready to receive payments' });
    }

    const feePercent = Number(process.env.PLATFORM_FEE_PERCENT || 20);
    const platformFee = Math.round((listing.price * feePercent) / 100);
    const sellerPayout = listing.price - platformFee;

    const checkout = await dodoPayments.createCheckoutSession({
      amount: listing.price,
      merchantId: seller.dodopaymentsMerchantId,
      platformFee,
      metadata: {
        listingId: String(listing._id),
        buyerId: String(req.user._id),
        sellerId: String(seller._id)
      },
      customer: {
        email: req.user.email,
        name: req.user.name
      }
    });

    await Transaction.create({
      listingId: listing._id,
      buyerId: req.user._id,
      sellerId: seller._id,
      amount: listing.price,
      platformFee,
      sellerPayout,
      dodoPaymentId: checkout.payment_id || checkout.paymentId || checkout.id || checkout.session_id,
      status: 'pending'
    });

    return res.json({
      success: true,
      checkoutUrl: checkout.checkout_url || checkout.checkoutUrl || checkout.url
    });
  } catch (error) {
    return next(error);
  }
};

const webhook = async (req, res, next) => {
  try {
    const rawBodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const signatureHeaders = {
      'webhook-id': req.headers['webhook-id'],
      'webhook-signature': req.headers['webhook-signature'],
      'webhook-timestamp': req.headers['webhook-timestamp']
    };

    res.sendStatus(200);

    setImmediate(async () => {
      try {
        const event = dodoPayments.unwrapWebhook(rawBodyBuffer, signatureHeaders);

        if (event.type === 'payment.succeeded' || event.type === 'payment.success') {
          const paymentId = event.data && (event.data.payment_id || event.data.paymentId);
          const transferId = event.data && (event.data.transfer_id || event.data.transferId);

          if (paymentId) {
            await Transaction.findOneAndUpdate(
              { dodoPaymentId: paymentId },
              {
                status: 'completed',
                dodoPaymentId: paymentId,
                dodoTransferId: transferId
              }
            );
          }
        }

        if (event.type === 'merchant.approved') {
          const merchantId = event.data && (event.data.merchant_id || event.data.merchantId);
          if (merchantId) {
            await User.findOneAndUpdate(
              { dodopaymentsMerchantId: merchantId },
              { sellerStatus: 'active' }
            );
          }
        }
      } catch (error) {
        console.error('Webhook processing failed:', error.message);
      }
    });
  } catch (error) {
    return next(error);
  }
};

const getSellerDashboard = async (req, res, next) => {
  try {
    if (!['seller', 'both'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Seller access required' });
    }

    const sellerId = req.user._id;

    const [totals, completedTransactions, listingBreakdown] = await Promise.all([
      Transaction.aggregate([
        { $match: { sellerId } },
        {
          $group: {
            _id: null,
            totalEarnings: {
              $sum: {
                $cond: [{ $eq: ['$status', 'completed'] }, '$sellerPayout', 0]
              }
            },
            pendingPayouts: {
              $sum: {
                $cond: [{ $eq: ['$status', 'pending'] }, '$sellerPayout', 0]
              }
            }
          }
        }
      ]),
      Transaction.find({ sellerId, status: 'completed' }).sort({ createdAt: -1 }).populate('listingId', 'title'),
      Transaction.aggregate([
        { $match: { sellerId, status: 'completed' } },
        {
          $group: {
            _id: '$listingId',
            totalSales: { $sum: 1 },
            totalEarnings: { $sum: '$sellerPayout' }
          }
        },
        {
          $lookup: {
            from: 'listings',
            localField: '_id',
            foreignField: '_id',
            as: 'listing'
          }
        },
        { $unwind: '$listing' },
        {
          $project: {
            _id: 0,
            listingId: '$_id',
            title: '$listing.title',
            totalSales: 1,
            totalEarnings: 1
          }
        }
      ])
    ]);

    const summary = totals[0] || { totalEarnings: 0, pendingPayouts: 0 };

    return res.json({
      success: true,
      totalEarnings: summary.totalEarnings,
      pendingPayouts: summary.pendingPayouts,
      completedTransactions,
      listingBreakdown
    });
  } catch (error) {
    return next(error);
  }
};

const buy = async (req, res, next) => {
  try {
    const { listingId } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing || listing.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Listing not found or unavailable' });
    }

    if (String(listing.sellerId) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: 'You cannot purchase your own listing' });
    }

    const existing = await Transaction.findOne({
      listingId: listing._id,
      buyerId: req.user._id,
      status: 'completed'
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already purchased this skill' });
    }

    const feePercent = Number(process.env.PLATFORM_FEE_PERCENT || 20);
    const platformFee = Math.round((listing.price * feePercent) / 100);
    const sellerPayout = listing.price - platformFee;

    const transaction = await Transaction.create({
      listingId: listing._id,
      buyerId: req.user._id,
      sellerId: listing.sellerId,
      amount: listing.price,
      platformFee,
      sellerPayout,
      status: 'completed'
    });

    await Listing.findByIdAndUpdate(listing._id, { $inc: { purchaseCount: 1 } });

    return res.json({ success: true, transaction });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createCheckout,
  buy,
  webhook,
  getSellerDashboard
};
