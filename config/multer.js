const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = `${req.params.id || 'new'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipe file tidak didukung. Gunakan: JPG, PNG, GIF, WEBP, PDF, DOC, DOCX, XLS, XLSX, TXT, ZIP'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

function isImage(mimeType) {
  return IMAGE_MIME.has(mimeType);
}

function fileIcon(mimeType) {
  if (IMAGE_MIME.has(mimeType))           return { icon: 'fa-file-image',   color: 'text-info' };
  if (mimeType === 'application/pdf')     return { icon: 'fa-file-pdf',     color: 'text-danger' };
  if (mimeType.includes('word'))          return { icon: 'fa-file-word',    color: 'text-primary' };
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet'))
                                          return { icon: 'fa-file-excel',   color: 'text-success' };
  if (mimeType === 'text/plain')          return { icon: 'fa-file-alt',     color: 'text-secondary' };
  if (mimeType.includes('zip'))           return { icon: 'fa-file-archive', color: 'text-warning' };
  return                                         { icon: 'fa-file',         color: 'text-muted' };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = { upload, UPLOAD_DIR, isImage, fileIcon, formatBytes };
