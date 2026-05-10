const crypto = require('crypto');
const Razorpay = require('razorpay');

const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

/** Minimum withdrawal amount in cents ($30.00). */
const WITHDRAW_MIN_CENTS = 3000;
const MIN_ORDER_AMOUNT = 100;

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error('Razorpay is not configured');
    error.status = 500;
    throw error;
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
};

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

    if (!Number.isInteger(listing.price) || listing.price < MIN_ORDER_AMOUNT) {
      return res.status(400).json({ success: false, message: 'Listing price must be at least 100 paise' });
    }

    const feePercent = Number(process.env.PLATFORM_FEE_PERCENT || 20);
    const platformFee = Math.round((listing.price * feePercent) / 100);
    const sellerPayout = listing.price - platformFee;

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: listing.price,
      currency: 'INR',
      receipt: `listing_${listing._id}_${Date.now()}`
    });

    await Transaction.create({
      listingId: listing._id,
      buyerId: req.user._id,
      sellerId: listing.sellerId,
      amount: listing.price,
      platformFee,
      sellerPayout,
      razorpayOrderId: order.id,
      status: 'pending'
    });

    return res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    if (error && error.statusCode === 401) {
      return res.status(401).json({ success: false, message: 'Razorpay authentication failed' });
    }
    return next(error);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing required payment fields' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({ success: false, message: 'Razorpay is not configured' });
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    const transaction = await Transaction.findOne({
      razorpayOrderId: razorpay_order_id,
      status: 'pending'
    });
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Pending transaction not found' });
    }

    transaction.status = 'completed';
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    await transaction.save();

    await Listing.findByIdAndUpdate(transaction.listingId, { $inc: { purchaseCount: 1 } });

    return res.json({ success: true, transaction });
  } catch (error) {
    return next(error);
  }
};

const getSellerDashboard = async (req, res, next) => {
  try {
    // Any authenticated user can view their seller dashboard.
    // If they have no listings/earnings the numbers are simply zero.

    const sellerId = req.user._id;

    const [earningsTotals, completedTransactions, listingBreakdown, withdrawnTotals, withdrawalHistory] =
      await Promise.all([
        // Total earned from completed sales
        Transaction.aggregate([
          { $match: { sellerId, type: 'purchase', status: 'completed' } },
          { $group: { _id: null, totalEarnings: { $sum: '$sellerPayout' } } }
        ]),
        // List of completed purchase transactions
        Transaction.find({ sellerId, type: 'purchase', status: 'completed' })
          .sort({ createdAt: -1 })
          .populate('listingId', 'title'),
        // Per-listing breakdown
        Transaction.aggregate([
          { $match: { sellerId, type: 'purchase', status: 'completed' } },
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
        ]),
        // Sum of non-failed withdrawals (counts against available balance)
        Transaction.aggregate([
          { $match: { sellerId, type: 'withdrawal', status: { $in: ['pending', 'completed'] } } },
          { $group: { _id: null, totalWithdrawn: { $sum: '$amount' } } }
        ]),
        // Withdrawal history sorted newest first
        Transaction.find({ sellerId, type: 'withdrawal' })
          .sort({ createdAt: -1 })
          .lean()
      ]);

    const totalEarnings = (earningsTotals[0] || {}).totalEarnings || 0;
    const totalWithdrawn = (withdrawnTotals[0] || {}).totalWithdrawn || 0;
    // Pending payouts = money earned but not yet withdrawn
    const pendingPayouts = Math.max(0, totalEarnings - totalWithdrawn);

    return res.json({
      success: true,
      totalEarnings,
      pendingPayouts,
      completedTransactions,
      listingBreakdown,
      withdrawalHistory
    });
  } catch (error) {
    return next(error);
  }
};

const withdraw = async (req, res, next) => {
  try {
    const { amount, bankDetails } = req.body;
    const amountCents = Math.round(Number(amount));

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal amount.' });
    }
    if (amountCents < WITHDRAW_MIN_CENTS) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal is $${(WITHDRAW_MIN_CENTS / 100).toFixed(2)}.`
      });
    }

    const sellerId = req.user._id;

    // Calculate current available balance
    const [earningsRes, withdrawnRes] = await Promise.all([
      Transaction.aggregate([
        { $match: { sellerId, type: 'purchase', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$sellerPayout' } } }
      ]),
      Transaction.aggregate([
        { $match: { sellerId, type: 'withdrawal', status: { $in: ['pending', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const totalEarnings = (earningsRes[0] || {}).total || 0;
    const totalWithdrawn = (withdrawnRes[0] || {}).total || 0;
    const available = Math.max(0, totalEarnings - totalWithdrawn);

    if (amountCents > available) {
      return res.status(400).json({
        success: false,
        message: `Cannot exceed available balance of $${(available / 100).toFixed(2)}.`
      });
    }

    const transaction = await Transaction.create({
      type: 'withdrawal',
      sellerId,
      amount: amountCents,
      bankDetails: bankDetails || {},
      status: 'pending'
    });

    return res.json({ success: true, withdrawal: transaction });
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
  verifyPayment,
  getSellerDashboard,
  withdraw
};
