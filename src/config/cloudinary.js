const { v2: cloudinary } = require('cloudinary');

cloudinary.config(process.env.CLOUDINARY_URL);

module.exports = cloudinary;
