const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const notifController = require('../controllers/notificationController');

router.get('/stream', requireAuth, notifController.stream);
router.get('/recent', requireAuth, notifController.recent);
router.get('/', requireAuth, notifController.index);
router.get('/:id/read', requireAuth, notifController.markRead);
router.post('/mark-all-read', requireAuth, notifController.markAllRead);
router.post('/delete-all', requireAuth, notifController.deleteAll);

module.exports = router;
