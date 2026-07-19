import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

type ResultState = {
  originalUrl: string;
  enhancedBase64: string;
};

export function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ResultState | null;

  useEffect(() => {
    if (!state?.originalUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(state.originalUrl);
    };
  }, [state?.originalUrl]);

  if (!state?.originalUrl || !state.enhancedBase64) {
    return <Navigate to="/" replace />;
  }

  const enhancedPreviewUrl = `data:image/png;base64,${state.enhancedBase64}`;

  return (
    <main className="page-shell">
      <section className="comparison-grid">
        <article className="card">
          <p className="card-label">Before</p>
          <img src={state.originalUrl} alt="Original product photo" className="preview-image" />
        </article>

        <article className="card">
          <p className="card-label">After</p>
          <img src={enhancedPreviewUrl} alt="Enhanced product photo" className="preview-image" />
        </article>
      </section>

      <section className="card actions-card">
        <a className="primary-button full-width button-link" href={enhancedPreviewUrl} download="snap-shine-enhanced.png">
          Download Enhanced Image
        </a>
        <button type="button" className="secondary-button full-width" onClick={() => navigate('/', { replace: true })}>
          Enhance Another
        </button>
      </section>
    </main>
  );
}
