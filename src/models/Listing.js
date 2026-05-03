const crypto = require('crypto');
const mongoose = require('mongoose');

const generateListingHashId = () => {
  return `0x${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    shortDescription: { type: String, trim: true, default: '' },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    price: { type: Number, required: true, min: 0 },
    pricingModel: { type: String, enum: ['one-time'], default: 'one-time', required: true },
    llmCompatibility: { type: [String], default: [] },
    fileUrl: { type: String },
    listingHashId: { type: String, unique: true, index: true },
    fileSizeBytes: { type: Number, min: 0, default: 0 },
    packageZipUrl: { type: String },
    packageManifest: { type: mongoose.Schema.Types.Mixed },
    coverImageUrl: { type: String },
    tags: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    purchaseCount: { type: Number, default: 0, min: 0 },
    verified: { type: Boolean, default: false, index: true },
    featured: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ['draft', 'pending-review', 'active', 'suspended'], default: 'draft' },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

listingSchema.pre('validate', async function preValidate(next) {
  if (this.listingHashId) {
    return next();
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateListingHashId();
    // Avoid duplicate collisions before save.
    // eslint-disable-next-line no-await-in-loop
    const exists = await this.constructor.exists({ listingHashId: candidate });
    if (!exists) {
      this.listingHashId = candidate;
      return next();
    }
  }

  return next(new Error('Could not generate unique listing hash id'));
});

module.exports = mongoose.model('Listing', listingSchema);
