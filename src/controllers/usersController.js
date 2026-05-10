const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const SellerInviteRequest = require('../models/SellerInviteRequest');

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
      select: '-passwordHash'
    });

    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
};

const becomeSeller = async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.json({ success: true, message: 'Admin users can already sell skills' });
    }

    const { skillType, skillSummary } = req.body;
    const existingRequest = await SellerInviteRequest.findOne({ userId: req.user._id });
    if (existingRequest && existingRequest.status === 'pending') {
      return res.status(409).json({ success: false, message: 'Seller invite request is already pending' });
    }

    const requestPayload = {
      skillType,
      skillSummary,
      status: 'pending',
      adminNotes: '',
      reviewedBy: null,
      reviewedAt: null
    };

    const inviteRequest = existingRequest
      ? await SellerInviteRequest.findOneAndUpdate({ userId: req.user._id }, requestPayload, { new: true })
      : await SellerInviteRequest.create({ userId: req.user._id, ...requestPayload });

    if (req.user.sellerStatus !== 'active') {
      req.user.sellerStatus = 'pending';
      await req.user.save();
    }

    return res.json({ success: true, request: inviteRequest });
  } catch (error) {
    return next(error);
  }
};

const getMySellerInviteRequest = async (req, res, next) => {
  try {
    const request = await SellerInviteRequest.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, request });
  } catch (error) {
    return next(error);
  }
};

const listSellerInviteRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) {
      query.status = status;
    }
    const requests = await SellerInviteRequest.find(query)
      .populate('userId', 'email name role sellerStatus')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });
    return res.json({ success: true, requests });
  } catch (error) {
    return next(error);
  }
};

const reviewSellerInviteRequest = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { status, adminNotes } = req.body;

    const inviteRequest = await SellerInviteRequest.findById(requestId);
    if (!inviteRequest) {
      return res.status(404).json({ success: false, message: 'Invite request not found' });
    }
    if (inviteRequest.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invite request already reviewed' });
    }

    inviteRequest.status = status;
    inviteRequest.adminNotes = adminNotes || '';
    inviteRequest.reviewedBy = req.user._id;
    inviteRequest.reviewedAt = new Date();
    await inviteRequest.save();

    const targetUser = await User.findById(inviteRequest.userId);
    if (targetUser) {
      if (status === 'approved') {
        targetUser.sellerStatus = 'active';
        if (targetUser.role === 'buyer') {
          targetUser.role = 'both';
        } else if (targetUser.role !== 'admin' && targetUser.role !== 'both') {
          targetUser.role = 'seller';
        }
      } else {
        targetUser.sellerStatus = 'none';
      }
      await targetUser.save();
    }

    return res.json({ success: true, request: inviteRequest });
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
  getMySellerInviteRequest,
  listSellerInviteRequests,
  reviewSellerInviteRequest,
  getMyPurchases,
  getMyListings
};
