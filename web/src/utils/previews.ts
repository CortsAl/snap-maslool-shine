export async function createSafePreviewUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Unable to create an image preview.');
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((previewBlob) => {
      if (previewBlob) {
        resolve(previewBlob);
        return;
      }

      reject(new Error('Unable to export the preview image.'));
    }, 'image/png');
  });

  return URL.createObjectURL(blob);
}
