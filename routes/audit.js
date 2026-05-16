const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const c = require('../controllers/auditController');

router.use(requireAuth, requireRole('admin'));
router.get('/', c.index);

module.exports = router;
