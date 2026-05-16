// Kebijakan password: minimal 8 karakter, mengandung huruf dan angka.
function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password minimal 8 karakter';
  if (!/[A-Za-z]/.test(s)) return 'Password harus mengandung huruf';
  if (!/[0-9]/.test(s)) return 'Password harus mengandung angka';
  return null; // valid
}
module.exports = { validatePassword };
