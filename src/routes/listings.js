const express = require('express');
const Joi = require('joi');

const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const listingsController = require('../controllers/listingsController');

const router = express.Router();

const createListingSchema = Joi.object({
  title: Joi.string().trim().required(),
  description: Joi.string().required(),
  shortDescription: Joi.string().trim().required(),
  price: Joi.number().integer().min(0).required(),
  pricingModel: Joi.string().valid('one-time').default('one-time'),
  llmCompatibility: Joi.array().items(Joi.string()).default([]),
  tags: Joi.array().items(Joi.string()).default([]),
  verified: Joi.boolean().optional(),
  featured: Joi.boolean().optional(),
  status: Joi.string().valid('draft', 'pending-review', 'active', 'suspended').optional(),
  fileUrl: Joi.string().uri().optional(),
  fileSizeBytes: Joi.number().integer().min(0).optional(),
  coverImageUrl: Joi.string().uri().optional()
});

const updateListingSchema = Joi.object({
  title: Joi.string().trim(),
  description: Joi.string(),
  shortDescription: Joi.string().trim(),
  price: Joi.number().integer().min(0),
  pricingModel: Joi.string().valid('one-time'),
  llmCompatibility: Joi.array().items(Joi.string()),
  tags: Joi.array().items(Joi.string()),
  verified: Joi.boolean(),
  featured: Joi.boolean(),
  status: Joi.string().valid('draft', 'pending-review', 'active', 'suspended'),
  fileUrl: Joi.string().uri(),
  fileSizeBytes: Joi.number().integer().min(0),
  coverImageUrl: Joi.string().uri()
}).min(1);

router.get('/', listingsController.listListings);
router.get('/featured', listingsController.listFeaturedListings);
router.get('/:id', listingsController.getListingById);
router.post('/', auth, validate(createListingSchema), listingsController.createListing);
router.patch('/:id', auth, validate(updateListingSchema), listingsController.updateListing);
router.delete('/:id', auth, listingsController.deleteListing);
router.post(
  '/:id/upload',
  auth,
  listingsController.upload.fields([
    { name: 'skillFile', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
  ]),
  listingsController.uploadListingAssets
);

module.exports = router;
