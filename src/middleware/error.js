const logger = require('../config/logger');

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

  logger.error('Request error', {
    method: req.method,
    path: req.originalUrl,
    status,
    message,
    code: err.code,
    stack: err.stack
  });

  return res.status(status).json({
    success: false,
    message,
    ...(err.code ? { code: err.code } : {})
  });
};

module.exports = errorMiddleware;
