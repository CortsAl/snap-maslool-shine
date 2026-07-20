import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sanitizeFileName } from '../utils/fileNames';

// Keep the frontend limit aligned with the backend /enhance-batch endpoint limit.
const MAX_FILES = 100;
const DISALLOWED_IMAGE_TYPES = new Set(['image/svg+xml']);

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function isSupportedImageFile(file: File) {
  return file.type.startsWith('image/') && !DISALLOWED_IMAGE_TYPES.has(file.type);
}

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);

  const previews = useMemo(
    () =>
      selectedFiles.map((file) => ({
        file,
        key: fileKey(file),
        displayName: sanitizeFileName(file.name),
        previewUrl: URL.createObjectURL(file),
      })),
    [selectedFiles],
  );

  useEffect(() => {
    return () => {
      previews.forEach((preview) => {
        URL.revokeObjectURL(preview.previewUrl);
      });
    };
  }, [previews]);

  const addFiles = (incomingFiles: FileList | File[] | null) => {
    const nextFiles = Array.from(incomingFiles ?? []).filter((file) => isSupportedImageFile(file));

    if (!nextFiles.length) {
      setSelectionMessage('Please choose supported raster image files. SVG files are not supported.');
      return;
    }

    setSelectedFiles((currentFiles) => {
      const mergedFiles = [...currentFiles];
      const existingKeys = new Set(currentFiles.map((file) => fileKey(file)));

      nextFiles.forEach((file) => {
        const key = fileKey(file);
        if (!existingKeys.has(key)) {
          mergedFiles.push(file);
          existingKeys.add(key);
        }
      });

      if (mergedFiles.length > MAX_FILES) {
        setSelectionMessage(`You can select up to ${MAX_FILES} photos at once.`);
        return mergedFiles.slice(0, MAX_FILES);
      }

      setSelectionMessage(null);
      return mergedFiles;
    });
  };

  return (
    <main className="page-shell">
      <section className="card hero-card">
        <p className="eyebrow">Maslool Snap &amp; Shine</p>
        <h1 className="title">Snap &amp; Shine</h1>
        <p className="subtitle">
          Upload 1 to 100 product photos and let OpenAI create natural, realistic studio-quality images in one batch.
        </p>

        <div
          className={`drop-zone ${isDragging ? 'drop-zone-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <p className="drop-zone-text">Drag &amp; drop up to 100 photos here</p>
          <p className="drop-zone-or">or</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            Choose Photos
          </button>
          <p className="helper-text">JPEG, PNG, WEBP, GIF, BMP, and TIFF images are supported. SVG files are excluded.</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden-input"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <div className="selection-toolbar">
          <span className="selection-badge">
            {selectedFiles.length} photo{selectedFiles.length === 1 ? '' : 's'} selected
          </span>
          {selectedFiles.length > 0 ? (
            <button type="button" className="secondary-button small-button" onClick={() => setSelectedFiles([])}>
              Clear All
            </button>
          ) : null}
        </div>

        {selectionMessage ? <p className="error-text">{selectionMessage}</p> : null}

        {previews.length > 0 ? (
          <section className="thumbnail-grid" aria-label="Selected photos">
            {previews.map((preview) => (
              <article key={preview.key} className="card thumbnail-card">
                <img src={preview.previewUrl} alt={preview.displayName} className="thumbnail-image" />
                <div className="thumbnail-meta">
                  <p className="file-name">{preview.displayName}</p>
                  <button
                    type="button"
                    className="remove-button"
                    aria-label={`Remove ${preview.displayName}`}
                    onClick={() => {
                      setSelectedFiles((currentFiles) => currentFiles.filter((file) => fileKey(file) !== preview.key));
                    }}
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <div className="action-row">
          <button
            type="button"
            className="primary-button full-width"
            disabled={selectedFiles.length === 0}
            onClick={() => navigate('/processing', { state: { imageFiles: selectedFiles } })}
          >
            Enhance All Photos
          </button>
        </div>
      </section>
    </main>
  );
}
