import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../constants/api';

type ProcessingState = { imageFiles: File[] };
type ProcessingStatus = 'pending' | 'processing' | 'done' | 'failed';

type BatchApiResult = {
  index: number;
  filename: string;
  success: boolean;
  image?: string;
  error?: string;
};

type BatchEnhanceResponse = {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchApiResult[];
};

type BatchResult = BatchApiResult & { originalUrl: string };

const STATUS_LABELS: Record<ProcessingStatus, string> = {
  pending: '⏳ Pending',
  processing: '🔄 Processing',
  done: '✅ Done',
  failed: '❌ Failed',
};

export function ProcessingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const imageFiles = (location.state as ProcessingState | null)?.imageFiles ?? [];
  const previews = useMemo(
    () => imageFiles.map((file, index) => ({ index, filename: file.name, originalUrl: URL.createObjectURL(file) })),
    [imageFiles],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statuses, setStatuses] = useState<Record<number, ProcessingStatus>>(() =>
    Object.fromEntries(imageFiles.map((_, index) => [index, 'pending'])),
  );
  const handedOffToResultRef = useRef(false);

  useEffect(() => {
    setStatuses(Object.fromEntries(imageFiles.map((_, index) => [index, 'pending'])));
  }, [imageFiles]);

  useEffect(() => {
    if (!imageFiles.length) {
      return;
    }

    const controller = new AbortController();

    const enhanceImages = async () => {
      setErrorMessage(null);
      setUploadProgress(0);
      setStatuses(Object.fromEntries(previews.map((preview) => [preview.index, 'processing'])));

      try {
        const formData = new FormData();
        imageFiles.forEach((file) => {
          formData.append('files', file);
        });

        const response = await axios.post<BatchEnhanceResponse>(`${API_BASE_URL}/enhance-batch`, formData, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'multipart/form-data',
          },
          signal: controller.signal,
          timeout: 600000,
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) {
              return;
            }

            setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
          },
        });

        setUploadProgress(100);

        const resultsByIndex = new Map(response.data.results.map((result) => [result.index, result]));
        const nextResults: BatchResult[] = previews.map((preview) => {
          const result = resultsByIndex.get(preview.index);

          if (result?.success && result.image) {
            return { ...result, originalUrl: preview.originalUrl };
          }

          return {
            index: preview.index,
            filename: preview.filename,
            success: false,
            originalUrl: preview.originalUrl,
            error: result?.error || 'We could not enhance this photo.',
          };
        });

        setStatuses(
          Object.fromEntries(nextResults.map((result) => [result.index, result.success ? 'done' : 'failed'])) as Record<
            number,
            ProcessingStatus
          >,
        );

        handedOffToResultRef.current = true;
        navigate('/result', {
          replace: true,
          state: { results: nextResults },
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
          return;
        }

        setStatuses(Object.fromEntries(previews.map((preview) => [preview.index, 'failed'])));

        if (axios.isAxiosError(error)) {
          const detail = error.response?.data?.detail;
          setErrorMessage(typeof detail === 'string' ? detail : 'We could not enhance your photos right now. Please try again.');
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Please try again in a moment.');
      }
    };

    enhanceImages();

    return () => {
      controller.abort();
    };
  }, [attemptCount, imageFiles, navigate, previews]);

  useEffect(() => {
    return () => {
      if (!handedOffToResultRef.current) {
        previews.forEach((preview) => {
          URL.revokeObjectURL(preview.originalUrl);
        });
      }
    };
  }, [previews]);

  if (!imageFiles.length) {
    return <Navigate to="/" replace />;
  }

  const successfulCount = Object.values(statuses).filter((status) => status === 'done').length;
  const failedCount = Object.values(statuses).filter((status) => status === 'failed').length;

  return (
    <main className="page-shell">
      <section className="card summary-card">
        <p className="card-label">Batch Processing</p>
        <h2 className="status-title">Enhancing {imageFiles.length} product photo{imageFiles.length === 1 ? '' : 's'}</h2>
        <p className="subtitle">
          Uploading your batch to OpenAI, then processing each image in parallel for a natural studio-quality result.
        </p>

        <div className="progress-wrapper" aria-label="Upload progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
          <p className="progress-label">Upload progress: {uploadProgress}%</p>
        </div>

        <div className="status-summary-row">
          <span className="status-badge status-pending">Total: {imageFiles.length}</span>
          <span className="status-badge status-done">Done: {successfulCount}</span>
          <span className="status-badge status-failed">Failed: {failedCount}</span>
        </div>
      </section>

      {errorMessage ? (
        <section className="card status-card">
          <h2 className="status-title">Something went wrong</h2>
          <p className="subtitle centered">{errorMessage}</p>
          <button type="button" className="primary-button full-width" onClick={() => setAttemptCount((count) => count + 1)}>
            Retry
          </button>
          <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
            Go Back
          </button>
        </section>
      ) : (
        <section className="card status-card">
          <div className="spinner" aria-hidden="true" />
          <h2 className="status-title">Processing your batch...</h2>
          <p className="subtitle centered">Each card below updates from pending to processing, then done or failed.</p>
        </section>
      )}

      <section className="batch-grid" aria-label="Batch processing status">
        {previews.map((preview) => {
          const status = statuses[preview.index] ?? 'pending';
          return (
            <article key={`${preview.index}-${preview.filename}`} className="card batch-card">
              <img src={preview.originalUrl} alt={preview.filename} className="thumbnail-image" />
              <div className="batch-card-footer">
                <p className="file-name">{preview.filename}</p>
                <span className={`status-badge status-${status}`}>{STATUS_LABELS[status]}</span>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
