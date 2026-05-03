const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const dodoPayments = require('../config/dodopayments');

const getPublicProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('name avatarUrl bio role createdAt');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const updates = {};

    if (typeof req.body.name === 'string') {
      updates.name = req.body.name;
    }

    if (typeof req.body.bio === 'string') {
      updates.bio = req.body.bio;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
      select: '-passwordHash -dodopaymentsMerchantId'
    });

    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
};

const becomeSeller = async (req, res, next) => {
  try {
    let onboardingUrl = null;

    try {
      const sellerAccount = await dodoPayments.createSellerAccount({
        email: req.user.email,
        name: req.user.name,
        metadata: {
          userId: String(req.user._id)
        }
      });
      req.user.dodopaymentsMerchantId = sellerAccount.customer_id || sellerAccount.id;
      onboardingUrl = sellerAccount.onboarding_url || sellerAccount.onboardingUrl || null;
    } catch (dodoError) {
      // If Dodo fails (e.g. not configured), still promote the user to seller
      console.error('Dodo seller account creation failed:', dodoError.message);
    }

    req.user.sellerStatus = 'active';
    // Upgrade role: buyer → both, none/seller → seller
    if (req.user.role === 'buyer') {
      req.user.role = 'both';
    } else if (req.user.role !== 'both' && req.user.role !== 'admin') {
      req.user.role = 'seller';
    }

    await req.user.save();

    return res.json({ success: true, onboardingUrl });
  } catch (error) {
    return next(error);
  }
};

const getMyPurchases = async (req, res, next) => {
  try {
    const transactions = await Transaction.find({
      buyerId: req.user._id,
      status: 'completed'
    })
      .sort({ createdAt: -1 })
      .populate({
        path: 'listingId',
        populate: { path: 'sellerId', select: 'name avatarUrl' }
      })
      .lean();

    const listings = transactions
      .map((tx) => tx.listingId)
      .filter(Boolean);

    return res.json({ success: true, listings });
  } catch (error) {
    return next(error);
  }
};

const getMyListings = async (req, res, next) => {
  try {
    const listings = await Listing.find({ sellerId: req.user._id })
      .populate('sellerId', 'name avatarUrl')
      .sort({ createdAt: -1 });

    return res.json({ success: true, listings });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getPublicProfile,
  updateMe,
  becomeSeller,
  getMyPurchases,
  getMyListings
};
