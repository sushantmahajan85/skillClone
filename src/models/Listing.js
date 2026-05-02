const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    shortDescription: { type: String, required: true, trim: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: {
      type: String,
      enum: ['data-retrieval', 'code-generation', 'web-browsing', 'file-processing', 'api-connector', 'workflow'],
      required: true
    },
    price: { type: Number, required: true, min: 0 },
    pricingModel: { type: String, enum: ['one-time', 'subscription', 'per-use'], required: true },
    llmCompatibility: { type: [String], default: [] },
    interfaceType: { type: String, enum: ['openai-tool', 'mcp', 'both'], required: true },
    fileUrl: { type: String },
    coverImageUrl: { type: String },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'pending-review', 'active', 'suspended'], default: 'draft' },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Listing', listingSchema);
