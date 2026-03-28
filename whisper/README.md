# Whisper Transcription Service

This is a standalone HTTP service for transcribing audio files using the OpenAI Whisper model.

## Prerequisites

Make sure you have Python 3.9+ and `ffmpeg` installed on your system.

To install `ffmpeg` on macOS:
```bash
brew install ffmpeg
```

## Setup & Run

1. Create a virtual environment and install dependencies:
```bash
cd whisper
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Start the server:
```bash
python main.py
```
Or run with uvicorn directly:
```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

The service will run on `http://localhost:8001`.

## API Endpoint

- `POST /transcribe`
  - Body: `multipart/form-data` with a `file` field containing the audio blob.
  - Returns: `{"text": "transcribed text..."}`
