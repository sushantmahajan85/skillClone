const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }

  req.body = value;
  return next();
};

module.exports = validate;
