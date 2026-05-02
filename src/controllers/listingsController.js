const multer = require('multer');
const { Readable } = require('stream');

const Listing = require('../models/Listing');
const cloudinary = require('../config/cloudinary');

const upload = multer({ storage: multer.memoryStorage() });

const uploadToCloudinary = (fileBuffer, folder, resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        return resolve(result);
      }
    );

    Readable.from(fileBuffer).pipe(uploadStream);
  });
};

const listListings = async (req, res, next) => {
  try {
    const {
      q,
      category,
      pricingModel,
      interfaceType,
      llmCompatibility,
      minPrice,
      maxPrice,
      sortBy = 'newest',
      page = 1,
      limit = 20
    } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    const query = { status: 'active' };

    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { shortDescription: { $regex: q, $options: 'i' } }
      ];
    }

    if (category) {
      query.category = category;
    }

    if (pricingModel) {
      query.pricingModel = pricingModel;
    }

    if (interfaceType) {
      query.interfaceType = interfaceType;
    }

    if (llmCompatibility) {
      const values = Array.isArray(llmCompatibility)
        ? llmCompatibility
        : String(llmCompatibility)
            .split(',')
            .map((val) => val.trim())
            .filter(Boolean);

      if (values.length > 0) {
        query.llmCompatibility = { $in: values };
      }
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice !== undefined) {
        query.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined) {
        query.price.$lte = Number(maxPrice);
      }
    }

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      top_rated: { averageRating: -1 }
    };

    const sort = sortMap[sortBy] || sortMap.newest;

    const [listings, total] = await Promise.all([
      Listing.find(query)
        .sort(sort)
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit),
      Listing.countDocuments(query)
    ]);

    return res.json({
      success: true,
      listings,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit)
    });
  } catch (error) {
    return next(error);
  }
};

const getListingById = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('sellerId', 'name avatarUrl bio');

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    return res.json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

const createListing = async (req, res, next) => {
  try {
    if (req.user.sellerStatus !== 'active') {
      return res.status(403).json({ success: false, message: 'Only active sellers can create listings' });
    }

    const listing = await Listing.create({
      ...req.body,
      sellerId: req.user._id
    });

    return res.status(201).json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

const updateListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (String(listing.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this listing' });
    }

    Object.assign(listing, req.body);
    await listing.save();

    return res.json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

const deleteListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (String(listing.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this listing' });
    }

    listing.status = 'suspended';
    await listing.save();

    return res.json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

const uploadListingAssets = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (String(listing.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to upload for this listing' });
    }

    if (req.files && req.files.skillFile && req.files.skillFile[0]) {
      const fileResult = await uploadToCloudinary(req.files.skillFile[0].buffer, 'skill-marketplace/files', 'raw');
      listing.fileUrl = fileResult.secure_url;
    }

    if (req.files && req.files.coverImage && req.files.coverImage[0]) {
      const imageResult = await uploadToCloudinary(req.files.coverImage[0].buffer, 'skill-marketplace/covers', 'image');
      listing.coverImageUrl = imageResult.secure_url;
    }

    await listing.save();

    return res.json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  upload,
  listListings,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
  uploadListingAssets
};
