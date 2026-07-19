import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../constants/api';

type EnhanceResponse = { image: string };
type ProcessingState = { imageFile: File };

export function ProcessingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const imageFile = (location.state as ProcessingState | null)?.imageFile;
  const objectUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const handedOffToResultRef = useRef(false);

  useEffect(() => {
    if (!imageFile) {
      return;
    }

    const controller = new AbortController();

    const enhanceImage = async () => {
      setErrorMessage(null);

      try {
        const formData = new FormData();
        formData.append('file', imageFile);

        const response = await axios.post<EnhanceResponse>(`${API_BASE_URL}/enhance`, formData, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'multipart/form-data',
          },
          signal: controller.signal,
          timeout: 120000,
        });

        handedOffToResultRef.current = true;
        navigate('/result', {
          replace: true,
          state: {
            originalUrl: objectUrl,
            enhancedBase64: response.data.image,
          },
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
          return;
        }

        if (axios.isAxiosError(error)) {
          const detail = error.response?.data?.detail;
          setErrorMessage(typeof detail === 'string' ? detail : 'We could not enhance your photo right now. Please try again.');
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Please try again in a moment.');
      }
    };

    enhanceImage();

    return () => {
      controller.abort();
    };
  }, [attemptCount, imageFile, navigate, objectUrl]);

  useEffect(() => {
    return () => {
      if (objectUrl && !handedOffToResultRef.current) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  if (!imageFile) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="page-shell">
      <section className="card">
        <p className="card-label">Original Photo</p>
        <img src={objectUrl} alt="Original upload preview" className="preview-image" />
      </section>

      <section className="card status-card">
        {errorMessage ? (
          <>
            <h2 className="status-title">Something went wrong</h2>
            <p className="subtitle centered">{errorMessage}</p>
            <button type="button" className="primary-button full-width" onClick={() => setAttemptCount((count) => count + 1)}>
              Retry
            </button>
            <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
              Choose Another Photo
            </button>
          </>
        ) : (
          <>
            <div className="spinner" aria-hidden="true" />
            <h2 className="status-title">Enhancing your product photo...</h2>
            <p className="subtitle centered">
              We are removing the background, refining the lighting, and creating a clean studio finish.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
