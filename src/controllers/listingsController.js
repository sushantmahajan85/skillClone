const path = require('path');
const multer = require('multer');
const { Readable } = require('stream');
const AdmZip = require('adm-zip');

const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const cloudinary = require('../config/cloudinary');

const upload = multer({ storage: multer.memoryStorage() });

const MAX_PACKAGE_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_PACKAGE_FILES = 500;

const normalizeEntryPath = (entryName) =>
  String(entryName || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/(\.\.\/)+/g, '');

const inferResourceType = (relativePath) => {
  const lower = relativePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(lower)) {
    return 'image';
  }
  if (/\.(mp4|webm|mov)$/i.test(lower)) {
    return 'video';
  }
  return 'raw';
};

const uploadToCloudinary = (fileBuffer, folder, resourceType = 'auto', extraOptions = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        ...extraOptions
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

const isZipUpload = (file) => {
  if (!file) {
    return false;
  }
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return name.endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed';
};

/** Ensures multer file.originalname ends with `.zip` when we handle it as a zip (MIME-only uploads, etc.). */
const ensureZipFilename = (file) => {
  const base = String(file.originalname || 'package').trim() || 'package';
  if (!base.toLowerCase().endsWith('.zip')) {
    file.originalname = `${base}.zip`;
  }
};

/** Safe Cloudinary `public_id` segment ending in `.zip` so raw bundle URLs retain a zip-like name. */
const sanitizeZipBundlePublicId = (originalname) => {
  const name = String(originalname || 'package.zip').trim() || 'package.zip';
  const withZip = name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`;
  const base = path.basename(withZip);
  const stem = base.replace(/\.zip$/i, '');
  const safe =
    stem
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'package';
  return `${safe}.zip`;
};

/** Plain listing JSON for visitors who have not purchased.
 *  - Strips download URLs (fileUrl, packageZipUrl).
 *  - Keeps packageManifest but redacts per-file URLs so the file tree is visible.
 */
const listingWithoutDownloadAssets = (listing) => {
  const plain = listing.toObject ? listing.toObject() : { ...listing };
  delete plain.fileUrl;
  delete plain.packageZipUrl;

  if (plain.packageManifest && Array.isArray(plain.packageManifest.files)) {
    plain.packageManifest = {
      version: plain.packageManifest.version,
      uploadedAt: plain.packageManifest.uploadedAt,
      fileCount: plain.packageManifest.fileCount,
      totalUncompressedBytes: plain.packageManifest.totalUncompressedBytes,
      files: plain.packageManifest.files.map((f) => ({
        path: f.path,
        bytes: f.bytes,
        resourceType: f.resourceType
        // url intentionally omitted — buyers get it after purchase
      }))
    };
  }

  return plain;
};

const formatBuyerTransaction = (tx) => ({
  _id: tx._id,
  amount: tx.amount,
  platformFee: tx.platformFee,
  sellerPayout: tx.sellerPayout,
  status: tx.status,
  dodoPaymentId: tx.dodoPaymentId,
  dodoTransferId: tx.dodoTransferId,
  createdAt: tx.createdAt
});

const CATEGORIES = [
  { slug: 'content-writing', label: 'Content Writing' },
  { slug: 'seo-growth', label: 'SEO & Growth' },
  { slug: 'data-analysis', label: 'Data Analysis' },
  { slug: 'coding-dev', label: 'Coding & Dev' },
  { slug: 'image-video', label: 'Image & Video' },
  { slug: 'research', label: 'Research' },
  { slug: 'productivity', label: 'Productivity' },
  { slug: 'social-media', label: 'Social Media' },
  { slug: 'customer-support', label: 'Customer Support' },
  { slug: 'finance', label: 'Finance' },
  { slug: 'legal', label: 'Legal' },
  { slug: 'education', label: 'Education' }
];

const listCategories = async (req, res) => {
  return res.json({ success: true, categories: CATEGORIES });
};

const listListings = async (req, res, next) => {
  try {
    const { q, sortBy = 'newest', category, page = 1, limit = 20 } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    const query = { status: 'active' };

    if (q) {
      const values = String(q)
        .split(',')
        .map((val) => val.trim())
        .filter(Boolean);

      if (values.length > 0) {
        const regex = new RegExp(values.join('|'), 'i');
        query.$or = [
          { tags: { $in: values } },
          { title: { $regex: regex } },
          { shortDescription: { $regex: regex } },
          { description: { $regex: regex } }
        ];
      }
    }

    if (category) {
      query.categories = category;
    }

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      top_rated: { averageRating: -1 },
      popular: { purchaseCount: -1 }
    };

    const sort = sortMap[sortBy] || sortMap.newest;

    const [listings, total] = await Promise.all([
      Listing.find(query)
        .populate('sellerId', 'name avatarUrl')
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

const listFeaturedListings = async (req, res, next) => {
  try {
    const { limit = 6 } = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 24);

    const listings = await Listing.find({
      status: 'active',
      featured: true
    })
      .populate('sellerId', 'name avatarUrl')
      .sort({ createdAt: -1 })
      .limit(parsedLimit);

    return res.json({
      success: true,
      listings,
      count: listings.length
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

    const user = req.user;
    const sellerRef = listing.sellerId;
    const sellerIdStr = String(sellerRef && sellerRef._id ? sellerRef._id : sellerRef);
    const isSeller = user && String(user._id) === sellerIdStr;
    const isAdmin = user && user.role === 'admin';

    if (isSeller || isAdmin) {
      return res.json({ success: true, listing });
    }

    let purchase = null;
    if (user) {
      purchase = await Transaction.findOne({
        listingId: listing._id,
        buyerId: user._id,
        status: 'completed'
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    if (purchase) {
      return res.json({
        success: true,
        listing: listing.toObject(),
        transaction: formatBuyerTransaction(purchase)
      });
    }

    return res.json({
      success: true,
      listing: listingWithoutDownloadAssets(listing)
    });
  } catch (error) {
    return next(error);
  }
};

const createListing = async (req, res, next) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'verified') && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can set verified' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'featured') && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can set featured' });
    }

    const payload = { ...req.body };
    if (req.user.role !== 'admin') {
      delete payload.verified;
      delete payload.featured;
    }

    const listing = await Listing.create({
      ...payload,
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

    const isOwner = String(listing.sellerId) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';
    const { verified, featured, ...rest } = req.body;
    const hasVerified = Object.prototype.hasOwnProperty.call(req.body, 'verified');
    const hasFeatured = Object.prototype.hasOwnProperty.call(req.body, 'featured');

    if (hasVerified && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can set verified' });
    }

    if (hasFeatured && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can set featured' });
    }

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this listing' });
    }

    if (isAdmin && !isOwner) {
      const otherKeys = Object.keys(rest);
      if (otherKeys.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Admins may only update verified or featured on listings they do not own'
        });
      }
      if (!hasVerified && !hasFeatured) {
        return res.status(400).json({ success: false, message: 'No updatable fields' });
      }
      if (hasVerified) {
        listing.verified = verified;
      }
      if (hasFeatured) {
        listing.featured = featured;
      }
      await listing.save();
      return res.json({ success: true, listing });
    }

    const payload = { ...rest };
    if (isAdmin && hasVerified) {
      payload.verified = verified;
    }
    if (isAdmin && hasFeatured) {
      payload.featured = featured;
    }

    Object.assign(listing, payload);
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
      const skillFile = req.files.skillFile[0];

      if (isZipUpload(skillFile)) {
        ensureZipFilename(skillFile);
        const zipSize = skillFile.size || skillFile.buffer.length;
        if (zipSize > MAX_PACKAGE_ZIP_BYTES) {
          return res.status(400).json({
            success: false,
            message: `Package zip must be ${MAX_PACKAGE_ZIP_BYTES / (1024 * 1024)}MB or smaller`
          });
        }

        const zipUpload = await uploadToCloudinary(
          skillFile.buffer,
          `skill-marketplace/packages/${listing._id}/bundle`,
          'raw',
          { public_id: sanitizeZipBundlePublicId(skillFile.originalname) }
        );

        const zip = new AdmZip(skillFile.buffer);
        const entries = zip.getEntries();
        const files = [];
        let totalUncompressed = 0;

        for (const entry of entries) {
          if (entry.isDirectory) {
            continue;
          }

          const relativePath = normalizeEntryPath(entry.entryName);
          if (!relativePath || relativePath.endsWith('/')) {
            continue;
          }

          const data = entry.getData();
          totalUncompressed += data.length;
          if (totalUncompressed > MAX_UNCOMPRESSED_TOTAL_BYTES) {
            return res.status(400).json({
              success: false,
              message: 'Unpacked package exceeds maximum allowed size'
            });
          }

          if (files.length >= MAX_PACKAGE_FILES) {
            return res.status(400).json({
              success: false,
              message: `Package contains too many files (max ${MAX_PACKAGE_FILES})`
            });
          }

          const resourceType = inferResourceType(relativePath);
          const uploaded = await uploadToCloudinary(
            data,
            `skill-marketplace/packages/${listing._id}/files/${relativePath}`,
            resourceType
          );

          files.push({
            path: relativePath,
            url: uploaded.secure_url,
            bytes: data.length,
            resourceType
          });
        }

        listing.packageZipUrl = zipUpload.secure_url;
        listing.fileUrl = zipUpload.secure_url;
        listing.fileSizeBytes = zipSize;
        listing.packageManifest = {
          version: 1,
          uploadedAt: new Date().toISOString(),
          fileCount: files.length,
          totalUncompressedBytes: totalUncompressed,
          files
        };
      } else {
        const fileResult = await uploadToCloudinary(skillFile.buffer, 'skill-marketplace/files', 'raw');
        listing.fileUrl = fileResult.secure_url;
        listing.fileSizeBytes = skillFile.size || listing.fileSizeBytes;
        listing.packageZipUrl = null;
        listing.packageManifest = null;
      }
    }

    if (req.files && req.files.coverImage && req.files.coverImage[0]) {
      const imageResult = await uploadToCloudinary(req.files.coverImage[0].buffer, 'skill-marketplace/covers', 'image');
      listing.coverImageUrl = imageResult.secure_url;
    }

    if (req.files && req.files.demoMedia && req.files.demoMedia.length > 0) {
      const demoResults = await Promise.all(
        req.files.demoMedia.map((file) => {
          const resourceType = inferResourceType(file.originalname);
          return uploadToCloudinary(
            file.buffer,
            `skill-marketplace/demo/${listing._id}`,
            resourceType
          ).then((result) => ({
            url: result.secure_url,
            resourceType: result.resource_type || resourceType,
            name: file.originalname
          }));
        })
      );
      listing.demoMedia = demoResults;
    }

    await listing.save();

    return res.json({ success: true, listing });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  upload,
  listCategories,
  listListings,
  listFeaturedListings,
  getListingById,
  createListing,
  updateListing,
  deleteListing,
  uploadListingAssets
};
