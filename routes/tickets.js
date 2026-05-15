const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware/auth');
const ticketController = require('../controllers/ticketController');
const { upload } = require('../config/multer');

// Wrapper agar error multer (ukuran/tipe) dikirim sebagai flash, bukan crash
function handleUpload(req, res, next) {
  upload.array('files', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      req.flash('error', err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file terlalu besar. Maksimal 10MB per file'
        : `Error upload: ${err.message}`);
      return res.redirect(`/tickets/${req.params.id}`);
    }
    if (err) {
      req.flash('error', err.message);
      return res.redirect(`/tickets/${req.params.id}`);
    }
    next();
  });
}

router.get('/', requireAuth, ticketController.index);
router.get('/create', requireAuth, requireRole('admin', 'reporter', 'supervisor'), ticketController.createPage);
router.post('/', requireAuth, requireRole('admin', 'reporter', 'supervisor'), ticketController.create);
router.get('/:id', requireAuth, ticketController.show);
router.get('/:id/edit', requireAuth, requireRole('admin'), ticketController.editPage);
router.put('/:id', requireAuth, requireRole('admin'), ticketController.update);
router.post('/:id/assign', requireAuth, requireRole('admin'), ticketController.assign);
router.post('/:id/status', requireAuth, ticketController.updateStatus);
router.post('/:id/comments', requireAuth, ticketController.addComment);
router.post('/:id/attachments', requireAuth, handleUpload, ticketController.uploadAttachment);
router.delete('/:id/attachments/:attachId', requireAuth, ticketController.deleteAttachment);
router.delete('/:id', requireAuth, requireRole('admin'), ticketController.deleteTicket);

module.exports = router;
