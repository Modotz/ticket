const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: (parseInt(process.env.LOGIN_WINDOW_MIN, 10) || 15) * 60 * 1000,
  max: (parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5) * 4, // batas keras per-IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.flash('error', 'Terlalu banyak percobaan login dari jaringan ini. Coba lagi nanti.');
    res.redirect('/auth/login');
  }
});

router.get('/login', authController.loginPage);
router.post('/login', loginLimiter, authController.login);
router.get('/logout', authController.logout);
router.get('/change-password', requireAuth, authController.changePasswordPage);
router.post('/change-password', requireAuth, authController.changePassword);

module.exports = router;
