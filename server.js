const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const passport = require('passport');
const morgan = require('morgan');

const connectDB = require('./src/config/db');
require('./src/config/cloudinary');
const logger = require('./src/config/logger');

const authRoutes = require('./src/routes/auth');
const listingsRoutes = require('./src/routes/listings');
const usersRoutes = require('./src/routes/users');
const paymentsRoutes = require('./src/routes/payments');
const errorMiddleware = require('./src/middleware/error');

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json());

app.use(passport.initialize());
require('./src/config/passport');

app.use(
  morgan(':method :url :status :response-time ms', {
    stream: {
      write: (message) => {
        logger.info(message.trim());
      }
    }
  })
);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/payments', paymentsRoutes);

app.use(errorMiddleware);

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
