const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String },
    passwordHash: { type: String },
    authProvider: { type: String, enum: ['local', 'google'], required: true },
    role: { type: String, enum: ['buyer', 'seller', 'both', 'admin'], default: 'buyer' },
    sellerStatus: { type: String, enum: ['none', 'pending', 'active'], default: 'none' },
    bio: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
