const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const passport = require('passport');

const connectDB = require('./src/config/db');
require('./src/config/cloudinary');

const authRoutes = require('./src/routes/auth');
const listingsRoutes = require('./src/routes/listings');
const usersRoutes = require('./src/routes/users');
const paymentsRoutes = require('./src/routes/payments');
const errorMiddleware = require('./src/middleware/error');

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

const parseOrigins = (value) =>
  String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = new Set([
  ...parseOrigins(process.env.CORS_ORIGINS),
  ...parseOrigins(process.env.FRONTEND_URLS),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : [])
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true
  })
);

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.path === '/api/payments/webhook') {
    return next();
  }
  return jsonParser(req, res, next);
});

app.use(passport.initialize());
require('./src/config/passport');

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/payments', paymentsRoutes);

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
