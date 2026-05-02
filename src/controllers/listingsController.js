const multer = require('multer');
const { Readable } = require('stream');
const AdmZip = require('adm-zip');

const Listing = require('../models/Listing');
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

const isZipUpload = (file) => {
  if (!file) {
    return false;
  }
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return name.endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed';
};

const listListings = async (req, res, next) => {
  try {
    const { q, sortBy = 'newest', page = 1, limit = 20 } = req.query;

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

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      top_rated: { averageRating: -1 }
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

    if (Object.prototype.hasOwnProperty.call(req.body, 'verified') && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can set verified' });
    }

    const payload = { ...req.body };
    if (req.user.role !== 'admin') {
      delete payload.verified;
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
    const { verified, ...rest } = req.body;
    const hasVerified = Object.prototype.hasOwnProperty.call(req.body, 'verified');

    if (hasVerified && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins can set verified' });
    }

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this listing' });
    }

    if (isAdmin && !isOwner) {
      const otherKeys = Object.keys(rest);
      if (otherKeys.length > 0) {
        return res.status(403).json({
          success: false,
          message: 'Admins may only update verified on listings they do not own'
        });
      }
      if (!hasVerified) {
        return res.status(400).json({ success: false, message: 'No updatable fields' });
      }
      listing.verified = verified;
      await listing.save();
      return res.json({ success: true, listing });
    }

    const payload = { ...rest };
    if (isAdmin && hasVerified) {
      payload.verified = verified;
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
          'raw'
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
