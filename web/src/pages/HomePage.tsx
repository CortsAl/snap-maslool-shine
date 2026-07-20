import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_IMAGE_FILES } from '../constants/uploads';

const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;

function getFileId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name);
}

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previewFiles = useMemo(
    () =>
      selectedFiles.map((file) => ({
        file,
        id: getFileId(file),
        url: URL.createObjectURL(file),
      })),
    [selectedFiles],
  );

  useEffect(() => {
    return () => {
      previewFiles.forEach((previewFile) => {
        URL.revokeObjectURL(previewFile.url);
      });
    };
  }, [previewFiles]);

  const handleFiles = (incomingFiles: FileList | File[] | null) => {
    const files = Array.from(incomingFiles ?? []);
    if (!files.length) {
      return;
    }

    let skippedNonImages = 0;
    let skippedDuplicates = 0;
    let skippedOverflow = 0;

    setSelectedFiles((currentFiles) => {
      const nextFiles = [...currentFiles];
      const existingFileIds = new Set(currentFiles.map((file) => getFileId(file)));

      for (const file of files) {
        if (!isImageFile(file)) {
          skippedNonImages += 1;
          continue;
        }

        const fileId = getFileId(file);
        if (existingFileIds.has(fileId)) {
          skippedDuplicates += 1;
          continue;
        }

        if (nextFiles.length >= MAX_IMAGE_FILES) {
          skippedOverflow += 1;
          continue;
        }

        nextFiles.push(file);
        existingFileIds.add(fileId);
      }

      return nextFiles;
    });

    const messages = [];
    if (skippedNonImages) {
      messages.push(`${skippedNonImages} non-image file${skippedNonImages === 1 ? '' : 's'} skipped.`);
    }
    if (skippedDuplicates) {
      messages.push(`${skippedDuplicates} duplicate photo${skippedDuplicates === 1 ? '' : 's'} skipped.`);
    }
    if (skippedOverflow) {
      messages.push(`Only the first ${MAX_IMAGE_FILES} photos can be added at once.`);
    }

    setErrorMessage(messages.length ? messages.join(' ') : null);
  };

  return (
    <main className="page-shell">
      <section className="card hero-card">
        <p className="eyebrow">Maslool Snap &amp; Shine</p>
        <h1 className="title">Snap &amp; Shine</h1>
        <p className="subtitle">
          Upload up to {MAX_IMAGE_FILES} product photos and enhance them in one batch with realistic studio lighting,
          a clean white background, and natural detail preservation.
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
            handleFiles(event.dataTransfer.files);
          }}
        >
          <p className="drop-zone-text">Drag &amp; drop up to {MAX_IMAGE_FILES} photos here</p>
          <p className="drop-zone-helper">Multiple images are processed together and returned ready to download.</p>
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
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <div className="selection-summary">
          <p className="selection-count">
            {selectedFiles.length} / {MAX_IMAGE_FILES} selected
          </p>
          {errorMessage ? <p className="selection-message">{errorMessage}</p> : null}
        </div>

        {previewFiles.length ? (
          <section className="thumbnail-grid" aria-label="Selected photo previews">
            {previewFiles.map((previewFile, index) => (
              <article key={previewFile.id} className="thumbnail-card">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${previewFile.file.name}`}
                  onClick={() => {
                    setSelectedFiles((currentFiles) =>
                      currentFiles.filter((file) => getFileId(file) !== previewFile.id),
                    );
                    setErrorMessage(null);
                  }}
                >
                  ×
                </button>
                <img src={previewFile.url} alt={previewFile.file.name} className="thumbnail-image" />
                <div className="thumbnail-meta">
                  <p className="thumbnail-name">{previewFile.file.name}</p>
                  <p className="thumbnail-caption">Photo {index + 1}</p>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <button
          type="button"
          className="primary-button full-width"
          disabled={!selectedFiles.length}
          onClick={() => navigate('/processing', { state: { imageFiles: selectedFiles } })}
        >
          Enhance All Photos
        </button>
      </section>
    </main>
  );
}
