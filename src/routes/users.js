const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const validate = require('../middleware/validate');
const usersController = require('../controllers/usersController');

const router = express.Router();

const updateMeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  bio: Joi.string().max(2000).allow('').optional()
}).min(1);

const becomeSellerSchema = Joi.object({
  skillType: Joi.string().trim().min(2).max(120).required(),
  skillSummary: Joi.string().trim().min(10).max(2000).required()
});

const reviewInviteSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  adminNotes: Joi.string().trim().allow('').max(2000).optional()
});

router.get('/me/purchases', auth, usersController.getMyPurchases);
router.get('/me/listings', auth, usersController.getMyListings);
router.get('/me/seller-invite-request', auth, usersController.getMySellerInviteRequest);
router.get('/:id/public', usersController.getPublicProfile);
router.patch('/me', auth, validate(updateMeSchema), usersController.updateMe);
router.post('/me/become-seller', auth, validate(becomeSellerSchema), usersController.becomeSeller);
router.get('/admin/seller-invite-requests', auth, admin, usersController.listSellerInviteRequests);
router.patch(
  '/admin/seller-invite-requests/:requestId',
  auth,
  admin,
  validate(reviewInviteSchema),
  usersController.reviewSellerInviteRequest
);

module.exports = router;
