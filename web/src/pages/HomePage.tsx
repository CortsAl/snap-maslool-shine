import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) {
      return;
    }

    navigate('/processing', { state: { imageFile: file } });
  };

  return (
    <main className="page-shell">
      <section className="card hero-card">
        <p className="eyebrow">Maslool Snap &amp; Shine</p>
        <h1 className="title">Snap &amp; Shine</h1>
        <p className="subtitle">
          Upload your product photo and we will remove the background, refine the lighting, and return a clean
          studio-style image.
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
            handleFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <p className="drop-zone-text">Drag &amp; drop a photo here</p>
          <p className="drop-zone-or">or</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            Choose Photo
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden-input"
          onChange={(event) => {
            handleFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
      </section>
    </main>
  );
}
