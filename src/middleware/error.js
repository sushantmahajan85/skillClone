const errorMiddleware = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err && err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Email already in use'
    });
  }

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  return res.status(status).json({
    success: false,
    message,
    ...(err.code ? { code: err.code } : {})
  });
};

module.exports = errorMiddleware;
