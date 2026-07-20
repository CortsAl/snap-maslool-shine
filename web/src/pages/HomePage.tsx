import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_IMAGE_FILES } from '../constants/uploads';
import { getFileId } from '../utils/files';
import { createSafePreviewUrl } from '../utils/previews';

const ACCEPTED_IMAGE_TYPES = '.avif,.bmp,.gif,.heic,.heif,.jpg,.jpeg,.png,.tif,.tiff,.webp';
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

function isImageFile(file: File) {
  return file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name);
}

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handedOffToProcessingRef = useRef(false);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrlsById, setPreviewUrlsById] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    previewUrlsRef.current = previewUrlsById;
  }, [previewUrlsById]);

  useEffect(() => {
    return () => {
      if (!handedOffToProcessingRef.current) {
        Object.values(previewUrlsRef.current).forEach((previewUrl) => {
          URL.revokeObjectURL(previewUrl);
        });
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const activeFileIds = new Set(selectedFiles.map((file) => getFileId(file)));

    setPreviewUrlsById((currentPreviewUrls) => {
      const nextPreviewUrls: Record<string, string> = {};

      Object.entries(currentPreviewUrls).forEach(([fileId, previewUrl]) => {
        if (activeFileIds.has(fileId)) {
          nextPreviewUrls[fileId] = previewUrl;
          return;
        }

        URL.revokeObjectURL(previewUrl);
      });

      return nextPreviewUrls;
    });

    const filesNeedingPreviews = selectedFiles.filter((file) => !previewUrlsRef.current[getFileId(file)]);
    if (!filesNeedingPreviews.length) {
      return () => {
        cancelled = true;
      };
    }

    const loadPreviews = async () => {
      const previewEntries = await Promise.all(
        filesNeedingPreviews.map(async (file) => {
          try {
            return {
              fileId: getFileId(file),
              previewUrl: await createSafePreviewUrl(file),
            };
          } catch {
            return {
              fileId: getFileId(file),
              previewUrl: '',
            };
          }
        }),
      );

      if (cancelled) {
        previewEntries.forEach(({ previewUrl }) => {
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
          }
        });
        return;
      }

      setPreviewUrlsById((currentPreviewUrls) => {
        const nextPreviewUrls = { ...currentPreviewUrls };

        previewEntries.forEach(({ fileId, previewUrl }) => {
          if (!previewUrl || nextPreviewUrls[fileId]) {
            if (previewUrl && nextPreviewUrls[fileId] !== previewUrl) {
              URL.revokeObjectURL(previewUrl);
            }
            return;
          }

          nextPreviewUrls[fileId] = previewUrl;
        });

        return nextPreviewUrls;
      });

      if (previewEntries.some(({ previewUrl }) => !previewUrl)) {
        setErrorMessage('We could not preview one or more selected photos. Please remove them and try again.');
      }
    };

    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [selectedFiles]);

  const previewFiles = selectedFiles.map((file) => ({
    file,
    id: getFileId(file),
    url: previewUrlsById[getFileId(file)] ?? '',
  }));
  const previewsReady = selectedFiles.every((file) => Boolean(previewUrlsById[getFileId(file)]));

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
          accept={ACCEPTED_IMAGE_TYPES}
          capture="environment"
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
                {previewFile.url ? (
                  <img src={previewFile.url} alt={previewFile.file.name} className="thumbnail-image" />
                ) : (
                  <div className="thumbnail-image thumbnail-placeholder" aria-label="Preparing photo preview" />
                )}
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
          disabled={!selectedFiles.length || !previewsReady}
          onClick={() => {
            handedOffToProcessingRef.current = true;
            navigate('/processing', {
              state: {
                imageFiles: selectedFiles,
                previewUrls: previewUrlsById,
              },
            });
          }}
        >
          {previewsReady ? 'Enhance All Photos' : 'Preparing previews...'}
        </button>
      </section>
    </main>
  );
}
