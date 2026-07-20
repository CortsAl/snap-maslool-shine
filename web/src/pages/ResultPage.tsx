import JSZip from 'jszip';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { BatchResult } from '../types/batch';

type ResultState = {
  results: BatchResult[];
};

function getDownloadName(filename: string, index: number) {
  const baseName = filename.replace(/\.[^.]+$/, '') || `photo-${index + 1}`;
  return `${baseName}-enhanced.png`;
}

function downloadBase64Image(filename: string, image: string) {
  const link = document.createElement('a');
  link.href = `data:image/png;base64,${image}`;
  link.download = filename;
  link.click();
}

export function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ResultState | null;
  const [showEnhancedByIndex, setShowEnhancedByIndex] = useState<Record<number, boolean>>({});
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.results.length) {
      return;
    }

    return () => {
      state.results.forEach((result) => {
        URL.revokeObjectURL(result.originalUrl);
      });
    };
  }, [state]);

  if (!state?.results.length) {
    return <Navigate to="/" replace />;
  }

  const successfulResults = state.results.filter((result) => result.success && result.image);

  return (
    <main className="page-shell">
      <section className="card status-card">
        <h2 className="status-title">
          {successfulResults.length} of {state.results.length} enhanced successfully
        </h2>
        <p className="subtitle centered">
          Review each photo, toggle between the original and enhanced versions, then download the results you want to keep.
        </p>

        <div className="button-row">
          <button
            type="button"
            className="primary-button full-width"
            disabled={!successfulResults.length || isDownloadingZip}
            onClick={async () => {
              setDownloadError(null);
              setIsDownloadingZip(true);

              try {
                const zip = new JSZip();

                successfulResults.forEach((result) => {
                  if (!result.image) {
                    return;
                  }

                  zip.file(getDownloadName(result.filename, result.index), result.image, {
                    base64: true,
                  });
                });

                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const downloadUrl = URL.createObjectURL(zipBlob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = 'snap-shine-enhanced-photos.zip';
                link.click();
                URL.revokeObjectURL(downloadUrl);
              } catch (error: unknown) {
                setDownloadError(error instanceof Error ? error.message : 'Could not create the ZIP file.');
              } finally {
                setIsDownloadingZip(false);
              }
            }}
          >
            {isDownloadingZip ? 'Preparing ZIP...' : 'Download All'}
          </button>
          <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
            Enhance More
          </button>
        </div>

        {downloadError ? <p className="selection-message">{downloadError}</p> : null}
      </section>

      <section className="result-grid" aria-label="Batch enhancement results">
        {state.results.map((result) => {
          const showEnhanced = showEnhancedByIndex[result.index] ?? result.success;
          const imageSrc = showEnhanced && result.image ? `data:image/png;base64,${result.image}` : result.originalUrl;

          return (
            <article key={`${result.index}-${result.filename}`} className="card result-card">
              <div className="thumbnail-header">
                <div>
                  <p className="card-label">Photo {result.index + 1}</p>
                  <p className="thumbnail-name">{result.filename}</p>
                </div>
                <span className={`status-badge status-${result.success ? 'done' : 'failed'}`}>
                  {result.success ? 'Done' : 'Failed'}
                </span>
              </div>

              <button
                type="button"
                className="result-toggle"
                disabled={!result.success || !result.image}
                onClick={() =>
                  setShowEnhancedByIndex((current) => ({
                    ...current,
                    [result.index]: !(current[result.index] ?? result.success),
                  }))
                }
              >
                <div className="toggle-button-row">
                  <span className={`toggle-chip ${!showEnhanced ? 'toggle-chip-active' : ''}`}>Before</span>
                  <span className={`toggle-chip ${showEnhanced ? 'toggle-chip-active' : ''}`}>After</span>
                </div>
                <img src={imageSrc} alt={result.filename} className="preview-image" />
              </button>

              {result.success && result.image ? (
                <button
                  type="button"
                  className="secondary-button full-width"
                  onClick={() => downloadBase64Image(getDownloadName(result.filename, result.index), result.image!)}
                >
                  Download PNG
                </button>
              ) : (
                <p className="selection-message">{result.error ?? 'This photo could not be enhanced.'}</p>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
