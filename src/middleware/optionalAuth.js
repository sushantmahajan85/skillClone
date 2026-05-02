const passport = require('passport');

/** Attaches req.user when a valid Bearer JWT is present; otherwise continues without auth. */
module.exports = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (err) {
      return next(err);
    }
    if (user) {
      req.user = user;
    }
    return next();
  })(req, res, next);
};
