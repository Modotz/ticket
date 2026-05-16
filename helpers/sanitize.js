const sanitizeHtml = require('sanitize-html');

// Whitelist tag/atribut untuk SEMUA tool Summernote (teks, warna, font,
// list, tabel, gambar, video, link). Yang TETAP dibuang: <script>,
// event handler (onclick, dll.), CSS berbahaya (url()/expression),
// dan iframe selain YouTube/Vimeo.
const OPTIONS = {
  allowedTags: [
    'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'sub', 'sup', 'small', 'mark', 'abbr', 'font',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'caption', 'colgroup', 'col', 'figure', 'figcaption', 'iframe'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'style'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style', 'class'],
    font: ['color', 'face', 'size'],
    span: ['style', 'class'],
    p: ['style', 'class'],
    div: ['style', 'class'],
    li: ['style'], ul: ['style'], ol: ['style'],
    h1: ['style'], h2: ['style'], h3: ['style'],
    h4: ['style'], h5: ['style'], h6: ['style'],
    table: ['style', 'class', 'border', 'cellpadding', 'cellspacing', 'width'],
    thead: ['style'], tbody: ['style'], tfoot: ['style'],
    tr: ['style'],
    td: ['style', 'colspan', 'rowspan', 'width', 'align', 'valign'],
    th: ['style', 'colspan', 'rowspan', 'width', 'align', 'valign'],
    col: ['span', 'width', 'style'],
    colgroup: ['span', 'width', 'style'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen']
  },
  allowedStyles: {
    '*': {
      'color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/, /^[a-zA-Z]+$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/, /^[a-zA-Z]+$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(underline|line-through|overline|none)$/],
      'font-weight': [/^(bold|bolder|lighter|normal|\d{3})$/],
      'font-style': [/^(italic|normal|oblique)$/],
      'font-family': [/^[\w\s"',\-]+$/],
      'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/, /^(xx-small|x-small|small|medium|large|x-large|xx-large)$/],
      'line-height': [/^\d+(\.\d+)?(px|em|%)?$/],
      'width': [/^\d+(\.\d+)?(px|%|em|rem)$/, /^auto$/],
      'height': [/^\d+(\.\d+)?(px|%|em|rem)$/, /^auto$/],
      'float': [/^(left|right|none)$/],
      'margin': [/^[\d\s.pxema%-]+$/],
      'padding': [/^[\d\s.pxema%-]+$/],
      'border': [/^[\w\s#().,%-]+$/],
      'border-collapse': [/^(collapse|separate)$/],
      'vertical-align': [/^(top|middle|bottom|baseline|sub|super)$/],
      'list-style-type': [/^[a-z-]+$/]
    }
  },
  // data: hanya untuk <img> (gambar tempel/upload base64) — tidak berbahaya
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https', 'data'],
    iframe: ['https']
  },
  // Video Summernote hanya dari host tepercaya
  allowedIframeHostnames: [
    'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
    'player.vimeo.com', 'vimeo.com'
  ],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  }
};

// Bersihkan HTML rich-text. String kosong tetap kosong.
function cleanHtml(input) {
  if (!input || typeof input !== 'string') return '';
  return sanitizeHtml(input, OPTIONS).trim();
}

module.exports = { cleanHtml };
