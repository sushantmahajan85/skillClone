const passport = require('passport');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const signToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const sanitizeUser = (user) => {
  const userObj = user.toObject();
  delete userObj.passwordHash;
  delete userObj.dodopaymentsMerchantId;
  return userObj;
};

const register = async (req, res, next) => {
  try {
    const { email, name, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      if (existing.authProvider === 'google') {
        return res.status(409).json({
          success: false,
          message: 'This account uses Google sign-in. Please continue with Google.'
        });
      }

      const error = new Error('Email already in use');
      error.status = 409;
      throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email: normalizedEmail,
      name,
      passwordHash,
      authProvider: 'local'
    });

    const token = signToken(user);

    return res.status(201).json({
      success: true,
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: info && info.message ? info.message : 'Invalid email or password'
      });
    }

    const token = signToken(user);
    return res.json({
      success: true,
      token,
      user: sanitizeUser(user)
    });
  })(req, res, next);
};

const googleAuth = passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false
});

const googleCallback = (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }

    if (!user) {
      const message = info && info.message ? info.message : 'google_auth_failed';
      if (message === 'account_exists_with_password') {
        return res.redirect(`${process.env.FRONTEND_URL}/auth/error?message=account_exists_with_password`);
      }

      return res.redirect(`${process.env.FRONTEND_URL}/auth/error?message=${encodeURIComponent(message)}`);
    }

    const token = signToken(user);
    return res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`);
  })(req, res, next);
};

const me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash -dodopaymentsMerchantId');
    return res.json({ success: true, user });
  } catch (error) {
    return next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  googleAuth,
  googleCallback,
  me,
  logout
};
