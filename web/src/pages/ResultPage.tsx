import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { sanitizeFileName, toPngFilename } from '../utils/fileNames';

type BatchResult = {
  index: number;
  filename: string;
  success: boolean;
  image?: string;
  originalUrl: string;
  error?: string;
};

type ResultState = {
  results: BatchResult[];
};

function createInitialToggleState(results: BatchResult[]) {
  return Object.fromEntries(results.map((result) => [result.index, result.success]));
}

function downloadBase64Image(filename: string, base64Image: string) {
  const link = document.createElement('a');
  link.href = `data:image/png;base64,${base64Image}`;
  link.download = toPngFilename(filename);
  link.click();
}

export function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ResultState | null;
  const results = Array.isArray(state?.results) ? state.results : [];
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [showAfterByIndex, setShowAfterByIndex] = useState<Record<number, boolean>>(() => createInitialToggleState(results));

  useEffect(() => {
    if (!results.length) {
      return;
    }

    return () => {
      results.forEach((result) => {
        URL.revokeObjectURL(result.originalUrl);
      });
    };
  }, [results]);

  const successfulResults = useMemo(() => results.filter((result) => result.success && result.image), [results]);

  if (!results.length) {
    return <Navigate to="/" replace />;
  }

  const handleDownloadAll = async () => {
    if (!successfulResults.length) {
      return;
    }

    setDownloadError(null);
    setIsDownloadingAll(true);

    try {
      const zip = new JSZip();
      successfulResults.forEach((result) => {
        if (!result.image) {
          return;
        }

        zip.file(toPngFilename(result.filename), result.image, { base64: true });
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = zipUrl;
      link.download = 'snap-shine-enhanced.zip';
      link.click();
      URL.revokeObjectURL(zipUrl);
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}. ` : '';
      setDownloadError(`${detail}We could not create the ZIP download. Please try downloading images individually or refresh the page.`);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="card summary-card">
        <div className="result-header">
          <div>
            <p className="card-label">Batch Results</p>
            <h2 className="status-title">
              {successfulResults.length} of {results.length} enhanced successfully
            </h2>
            <p className="subtitle">Preview each photo, switch between before and after, then download one image or the full ZIP.</p>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={successfulResults.length === 0 || isDownloadingAll}
            onClick={() => {
              void handleDownloadAll();
            }}
          >
            {isDownloadingAll ? 'Preparing ZIP…' : '⬇️ Download All'}
          </button>
        </div>
        {downloadError ? <p className="error-text">{downloadError}</p> : null}
      </section>

      <section className="result-grid" aria-label="Enhanced photos">
        {results.map((result) => {
          const safeFileName = sanitizeFileName(result.filename);
          const showAfter = Boolean(showAfterByIndex[result.index] && result.success && result.image);
          const imageSrc = showAfter && result.image ? `data:image/png;base64,${result.image}` : result.originalUrl;

          return (
            <article key={`${result.index}-${result.filename}`} className="card result-card">
              <div className="result-card-header">
                <p className="file-name">{safeFileName}</p>
                <span className={`status-badge status-${result.success ? 'done' : 'failed'}`}>
                  {result.success ? '✅ Done' : '❌ Failed'}
                </span>
              </div>

              <div className="preview-frame">
                <p className="image-stage-label">{showAfter ? 'After' : 'Before'}</p>
                <img src={imageSrc} alt={safeFileName} className="preview-image" />
              </div>

              {result.success && result.image ? (
                <button
                  type="button"
                  className="secondary-button full-width toggle-button"
                  onClick={() => {
                    setShowAfterByIndex((current) => ({ ...current, [result.index]: !current[result.index] }));
                  }}
                >
                  {showAfter ? 'Show Before' : 'Show After'}
                </button>
              ) : (
                <p className="error-text">{result.error || 'We could not enhance this photo.'}</p>
              )}

              <div className="result-card-actions">
                {result.success && result.image ? (
                  <button
                    type="button"
                    className="primary-button full-width"
                    onClick={() => {
                      if (result.image) {
                        downloadBase64Image(result.filename, result.image);
                      }
                    }}
                  >
                    ⬇️ Download
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="card actions-card">
        <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
          ✨ Enhance More
        </button>
      </section>
    </main>
  );
}
