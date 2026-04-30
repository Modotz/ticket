const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboardController');

router.get('/', requireAuth, dashboardController.index);

module.exports = router;
