import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../constants/api';
import type { BatchResult } from '../types/batch';
import { getFileId } from '../utils/files';

type BatchApiResult = Omit<BatchResult, 'originalUrl'>;
type BatchEnhanceResponse = {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchApiResult[];
};
type ProcessingState = { imageFiles: File[] };
type FileStatus = 'pending' | 'processing' | 'done' | 'failed';

const STATUS_LABELS: Record<FileStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
};

export function ProcessingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as (ProcessingState & { previewUrls?: Record<string, string> }) | null;
  const imageFiles = state?.imageFiles ?? [];
  const previewFiles = useMemo(
    () =>
      imageFiles.map((file, index) => ({
        index,
        file,
        id: getFileId(file),
        url: state?.previewUrls?.[getFileId(file)] ?? '',
      })),
    [imageFiles, state?.previewUrls],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>(() => imageFiles.map(() => 'pending'));
  const handedOffToResultRef = useRef(false);

  useEffect(() => {
    setFileStatuses(imageFiles.map(() => 'pending'));
    setOverallProgress(0);
  }, [imageFiles]);

  useEffect(() => {
    if (!imageFiles.length) {
      return;
    }

    const controller = new AbortController();

    const enhanceImages = async () => {
      setErrorMessage(null);
      setFileStatuses(imageFiles.map(() => 'processing'));
      setOverallProgress(5);

      try {
        const formData = new FormData();
        imageFiles.forEach((imageFile) => {
          formData.append('files', imageFile);
        });

        const response = await axios.post<BatchEnhanceResponse>(`${API_BASE_URL}/enhance-batch`, formData, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'multipart/form-data',
          },
          signal: controller.signal,
          timeout: 180000,
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) {
              setOverallProgress(20);
              return;
            }

            const uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 30);
            setOverallProgress(Math.max(5, Math.min(30, uploadProgress)));
          },
        });

        const results = previewFiles.map<BatchResult>(({ file, index, url }) => {
          const result = response.data.results[index];
          if (!result || result.index !== index) {
            return {
              index,
              filename: file.name,
              success: false,
              originalUrl: url,
              error: 'Image processing did not return a result.',
            };
          }

          return {
            ...result,
            originalUrl: url,
          };
        });

        setFileStatuses(results.map((result) => (result.success ? 'done' : 'failed')));
        setOverallProgress(100);
        handedOffToResultRef.current = true;
        navigate('/result', {
          replace: true,
          state: {
            results,
          },
        });
      } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
          return;
        }

        setFileStatuses(imageFiles.map(() => 'failed'));
        setOverallProgress(0);

        if (axios.isAxiosError(error)) {
          const detail = error.response?.data?.detail;
          setErrorMessage(typeof detail === 'string' ? detail : 'We could not enhance your photos right now. Please try again.');
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Please try again in a moment.');
      }
    };

    void enhanceImages();

    return () => {
      controller.abort();
    };
  }, [attemptCount, imageFiles, navigate, previewFiles]);

  useEffect(() => {
    return () => {
      if (!handedOffToResultRef.current) {
        previewFiles.forEach((previewFile) => {
          if (previewFile.url) {
            URL.revokeObjectURL(previewFile.url);
          }
        });
      }
    };
  }, [previewFiles]);

  if (!imageFiles.length) {
    return <Navigate to="/" replace />;
  }

  const completedCount = fileStatuses.filter((status) => status === 'done' || status === 'failed').length;

  return (
    <main className="page-shell">
      <section className="card status-card">
        <h2 className="status-title">Enhancing {imageFiles.length} photo{imageFiles.length === 1 ? '' : 's'}...</h2>
        <p className="subtitle centered">
          We are sending your original photos directly to OpenAI to create realistic white-background studio images.
        </p>

        <div className="progress-bar-shell" aria-label="Overall progress">
          <div className="progress-bar-fill" style={{ width: `${overallProgress}%` }} />
        </div>
        <p className="progress-caption">
          {errorMessage ? 'Processing paused' : `${completedCount} of ${imageFiles.length} completed`} · {overallProgress}%
        </p>

        {errorMessage ? (
          <>
            <p className="subtitle centered">{errorMessage}</p>
            <div className="button-row">
              <button type="button" className="primary-button full-width" onClick={() => setAttemptCount((count) => count + 1)}>
                Retry
              </button>
              <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
                Go Back
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section className="thumbnail-grid" aria-label="Batch processing queue">
        {previewFiles.map((previewFile) => (
          <article key={previewFile.id} className="thumbnail-card">
            {previewFile.url ? (
              <img src={previewFile.url} alt={previewFile.file.name} className="thumbnail-image" />
            ) : (
              <div className="thumbnail-image thumbnail-placeholder" aria-label="Preparing photo preview" />
            )}
            <div className="thumbnail-meta">
              <div className="thumbnail-header">
                <p className="thumbnail-name">{previewFile.file.name}</p>
                <span className={`status-badge status-${fileStatuses[previewFile.index]}`}>{STATUS_LABELS[fileStatuses[previewFile.index]]}</span>
              </div>
              <p className="thumbnail-caption">Photo {previewFile.index + 1}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
