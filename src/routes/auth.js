const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const authController = require('../controllers/authController');

const router = express.Router();

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().trim().min(2).max(100).required(),
  password: Joi.string().min(8).max(128).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.get('/google', authController.googleAuth);
router.get('/google/callback', authController.googleCallback);
router.get('/me', auth, authController.me);
router.post('/logout', auth, authController.logout);

module.exports = router;
