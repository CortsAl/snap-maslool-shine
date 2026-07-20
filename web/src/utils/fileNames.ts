export function sanitizeFileName(fileName: string) {
  const sanitized = fileName.replace(/[<>"'`]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return sanitized || 'photo';
}

export function toPngFilename(fileName: string) {
  return sanitizeFileName(fileName).replace(/\.[^./]+$/, '') + '.png';
}
