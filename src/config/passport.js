const passport = require('passport');
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      session: false
    },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        if (user.authProvider === 'google') {
          return done(null, false, {
            message: 'This account uses Google sign-in. Please continue with Google.'
          });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash || '');
        if (!isMatch) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_URL}/api/auth/google/callback`
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : null;
        const name = profile.displayName || 'Google User';
        const avatarUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : undefined;

        if (!email) {
          return done(null, false, { message: 'Google account does not have an email address' });
        }

        const userByGoogleId = await User.findOne({ googleId });
        if (userByGoogleId) {
          return done(null, userByGoogleId);
        }

        const userByEmail = await User.findOne({ email });
        if (userByEmail) {
          if (userByEmail.authProvider === 'local') {
            return done(null, false, { message: 'account_exists_with_password' });
          }

          userByEmail.googleId = googleId;
          userByEmail.avatarUrl = userByEmail.avatarUrl || avatarUrl;
          await userByEmail.save();
          return done(null, userByEmail);
        }

        const user = await User.create({
          googleId,
          email,
          name,
          avatarUrl,
          authProvider: 'google'
        });

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET
    },
    async (payload, done) => {
      try {
        const user = await User.findById(payload.userId);
        if (!user) {
          return done(null, false);
        }

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  )
);

module.exports = passport;
