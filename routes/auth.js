const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.get('/login', authController.loginPage);
router.post('/login', authController.login);
router.get('/logout', authController.logout);
router.get('/change-password', requireAuth, authController.changePasswordPage);
router.post('/change-password', requireAuth, authController.changePassword);

module.exports = router;
