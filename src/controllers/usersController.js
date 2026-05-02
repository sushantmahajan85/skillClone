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
    const sellerAccount = await dodoPayments.createSellerAccount({
      email: req.user.email,
      name: req.user.name,
      metadata: {
        userId: String(req.user._id)
      }
    });

    req.user.dodopaymentsMerchantId = sellerAccount.customer_id || sellerAccount.id;
    req.user.sellerStatus = 'pending';
    await req.user.save();

    return res.json({
      success: true,
      onboardingUrl: sellerAccount.onboarding_url || sellerAccount.onboardingUrl || null
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getPublicProfile,
  updateMe,
  becomeSeller
};
