# Whisper Transcription Service

This is a standalone HTTP service for transcribing audio files using the OpenAI Whisper model.

## Prerequisites

Make sure you have Python 3.9+.

The service uses `imageio-ffmpeg` to provide ffmpeg binary automatically. You do not need to install system ffmpeg manually.

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

- `GET /health`
  - Returns: `{"status": "ok"}`

- `POST /transcribe`
  - Body: `multipart/form-data` with a `file` field containing the audio blob.
  - Returns: `{"text": "transcribed text..."}`

## Frontend Integration

In DataClaw frontend:

1. Click username at bottom-left to open user menu.
2. Click `语音输入配置`.
3. Fill in service URL, e.g. `http://localhost:8001`.
4. Click `测试连接` first, then click `保存`.

After configuration, click the mic button in chat input area to start voice input.
