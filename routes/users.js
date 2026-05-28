const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const userController = require('../controllers/userController');

router.get('/', requireAuth, requireRole('admin'), userController.index);
router.get('/export', requireAuth, requireRole('admin'), userController.exportExcel);
router.get('/create', requireAuth, requireRole('admin'), userController.createPage);
router.post('/', requireAuth, requireRole('admin'), userController.create);
router.get('/:id/edit', requireAuth, requireRole('admin'), userController.editPage);
router.put('/:id', requireAuth, requireRole('admin'), userController.update);
router.delete('/:id', requireAuth, requireRole('admin'), userController.deleteUser);

module.exports = router;
