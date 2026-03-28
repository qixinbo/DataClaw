import os
import shutil
import ssl
import tempfile
import traceback
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import whisper
import imageio_ffmpeg

# Ensure whisper can execute "ffmpeg" command
_ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
_ffmpeg_bin_dir = os.path.join(tempfile.gettempdir(), "dataclaw_ffmpeg_bin")
_ffmpeg_link = os.path.join(_ffmpeg_bin_dir, "ffmpeg")
os.makedirs(_ffmpeg_bin_dir, exist_ok=True)
if not os.path.exists(_ffmpeg_link):
    try:
        os.symlink(_ffmpeg_exe, _ffmpeg_link)
    except OSError:
        shutil.copy2(_ffmpeg_exe, _ffmpeg_link)
        os.chmod(_ffmpeg_link, 0o755)
os.environ["PATH"] = _ffmpeg_bin_dir + os.pathsep + os.environ.get("PATH", "")

# Disable SSL verification temporarily to fix UNEXPECTED_EOF_WHILE_READING error during model download
ssl._create_default_https_context = ssl._create_unverified_context

app = FastAPI(title="Whisper Transcription Service")

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Load the whisper model globally. "small" is a good balance between speed and accuracy.
print("Loading Whisper model (small)... This may take a moment.")
model = whisper.load_model("small")
print("Model loaded successfully.")

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    # Save the uploaded file to a temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Convert webm to wav since Whisper's internal ffmpeg dependency can be problematic
        # We will use an alternative approach or just pass the webm if it works natively
        
        # Transcribe using whisper
        # Forcing language to Chinese for better accuracy on Chinese speech
        result = model.transcribe(tmp_path, language="zh", task="transcribe")
        return {"text": result.get("text", "")}
    except Exception as e:
        print(f"Error during transcription: {e}")
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        # Clean up the temporary file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
