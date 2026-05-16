const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, requireRole } = require('../middleware/auth');
const ticketController = require('../controllers/ticketController');
const { upload } = require('../config/multer');

// Wrapper agar error multer (ukuran/tipe) dikirim sebagai flash/JSON,
// bukan crash. upload.any() agar kompatibel dengan FormData fetch.
function handleUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        ? 'Ukuran file terlalu besar. Maksimal 10MB per file'
        : err.message;
      if (req.xhr || (req.headers.accept || '').includes('json')) {
        return res.status(400).json({ error: msg });
      }
      req.flash('error', msg);
      return res.redirect(`/tickets/${req.params.id}`);
    }
    next();
  });
}

// Upload saat membuat tiket. Dropzone (uploadMultiple) mengirim field
// bernama files[0], files[1], ... sehingga dipakai upload.any().
function handleCreateUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
        ? 'Ukuran file terlalu besar. Maksimal 10MB per file'
        : err.message;
      if (req.xhr || (req.headers.accept || '').includes('json')) {
        return res.status(400).json({ error: msg });
      }
      req.flash('error', msg);
      return res.redirect('/tickets/create');
    }
    next();
  });
}

router.get('/', requireAuth, ticketController.index);
router.get('/export', requireAuth, ticketController.exportExcel);
router.get('/create', requireAuth, requireRole('admin', 'reporter', 'supervisor'), ticketController.createPage);
router.post('/', requireAuth, requireRole('admin', 'reporter', 'supervisor'), handleCreateUpload, ticketController.create);
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
