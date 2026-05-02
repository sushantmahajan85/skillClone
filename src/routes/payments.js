const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const paymentsController = require('../controllers/paymentsController');

const router = express.Router();

const createCheckoutSchema = Joi.object({
  listingId: Joi.string().required()
});

router.post('/create-checkout', auth, validate(createCheckoutSchema), paymentsController.createCheckout);
router.post('/webhook', paymentsController.webhook);
router.get('/seller/dashboard', auth, paymentsController.getSellerDashboard);

module.exports = router;
