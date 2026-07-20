export function getFileId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}
