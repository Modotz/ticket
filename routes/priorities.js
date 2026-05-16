const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const c = require('../controllers/priorityController');

router.use(requireAuth, requireRole('admin'));

router.get('/', c.index);
router.get('/create', c.createPage);
router.post('/', c.create);
router.get('/:id/edit', c.editPage);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
