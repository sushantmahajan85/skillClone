const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

const createCheckoutSchema = Joi.object({
  listingId: Joi.string().required()
});

const buySchema = Joi.object({
  listingId: Joi.string().required()
});

const withdrawSchema = Joi.object({
  /** Amount in cents */
  amount: Joi.number().integer().min(1).required(),
  bankDetails: Joi.object().default({})
});

router.post('/buy', auth, validate(buySchema), paymentsController.buy);
router.post('/create-checkout', auth, validate(createCheckoutSchema), paymentsController.createCheckout);
router.post('/withdraw', auth, validate(withdrawSchema), paymentsController.withdraw);
router.post('/webhook', paymentsController.webhook);
router.get('/seller/dashboard', auth, paymentsController.getSellerDashboard);

module.exports = router;
