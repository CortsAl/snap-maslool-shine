# Use a small official Python image for the FastAPI backend.
FROM python:3.12-slim

# Keep Python output unbuffered so container logs stay readable.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python dependencies before copying the rest of the source.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend source code into the container image.
COPY . .

EXPOSE 8000

# Start the API on the default FastAPI/uvicorn development port.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
