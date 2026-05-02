const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const usersController = require('../controllers/usersController');

const router = express.Router();

const updateMeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  bio: Joi.string().max(2000).allow('').optional()
}).min(1);

router.get('/:id/public', usersController.getPublicProfile);
router.patch('/me', auth, validate(updateMeSchema), usersController.updateMe);
router.post('/me/become-seller', auth, usersController.becomeSeller);

module.exports = router;
