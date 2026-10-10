"""Relay's single, durable local transcription worker. No remote ASR calls."""
from __future__ import annotations

import argparse
import atexit
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone

APP = Path(__file__).resolve().parents[1]
CONFIG = json.loads((APP / "config/transcription.json").read_text())
ROOT = Path(os.environ.get("RELAY_DATA_DIR", str(APP / ".relay-data"))).resolve()
MODEL = os.environ.get("RELAY_WHISPER_MODEL", CONFIG["model"])
DEVICE = os.environ.get("RELAY_WHISPER_DEVICE", CONFIG["device"])
COMPUTE = os.environ.get("RELAY_WHISPER_COMPUTE_TYPE", CONFIG["computeType"])
STOP = threading.Event()


class JobError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class Cancelled(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def atomic_json(file: Path, value):
    # The parent must already exist: never resurrect a recording deleted by the UI.
    fd, temp = tempfile.mkstemp(prefix=".write-", suffix=".tmp", dir=file.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
        os.replace(temp, file)
    finally:
        Path(temp).unlink(missing_ok=True)


def emit(job, directory: Path, stage, kind, label, **metadata):
    job["stage"] = stage
    job["updatedAt"] = now()
    job["events"].append({"id": str(uuid.uuid4()), "at": job["updatedAt"],
                          "stage": stage, "kind": kind, "label": label, "metadata": metadata})
    atomic_json(directory / "job.json", job)


def check_cancel(directory: Path):
    if STOP.is_set() or not directory.exists() or (directory / ".delete").exists():
        raise Cancelled()


def run_media(args, directory: Path, timeout=60):
    check_cancel(directory)
    # Do not pipe unbounded decoder output into memory or expose it to the browser.
    with tempfile.TemporaryFile() as errors, tempfile.TemporaryFile() as output_file:
        process = subprocess.Popen(args, stdout=output_file, stderr=errors)
        started = time.monotonic()
        try:
            while process.poll() is None:
                check_cancel(directory)
                if time.monotonic() - started > timeout:
                    raise JobError("MEDIA_TIMEOUT", "Video preparation timed out. Try a shorter video.")
                time.sleep(0.1)
            output_file.seek(0)
            output = output_file.read(2_000_001)
            if len(output) > 2_000_000:
                raise JobError("INVALID_MEDIA", "The video contains too many streams or excessive metadata. Export a simpler MP4.")
            if process.returncode:
                raise JobError("VIDEO_DECODE_FAILED", "This video could not be decoded. Export it again as MP4 with H.264 video and AAC audio.")
            return output
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def validate_probe(probe):
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video:
        raise JobError("NO_VIDEO", "The file does not contain a playable video stream.")
    if not audio:
        raise JobError("NO_AUDIO", "This video has no audio track. Choose a video with spoken audio.")
    try:
        duration = float(probe.get("format", {}).get("duration", 0))
        width, height = int(video.get("width", 0)), int(video.get("height", 0))
    except (ValueError, TypeError):
        raise JobError("INVALID_MEDIA", "The recording has invalid duration or dimensions.") from None
    if not math.isfinite(duration) or duration <= 0:
        raise JobError("INVALID_DURATION", "The recording must have a finite, positive duration.")
    if duration > CONFIG["maxDurationSeconds"]:
        raise JobError("VIDEO_TOO_LONG", f"Videos must be {CONFIG['maxDurationSeconds'] // 60} minutes or shorter.")
    if width <= 0 or height <= 0 or max(width, height) > CONFIG["maxDimension"]:
        raise JobError("INVALID_DIMENSIONS", f"Choose a video no larger than {CONFIG['maxDimension']} pixels on either side.")
    return {"duration": duration, "width": width, "height": height,
            "videoCodec": video.get("codec_name", "unknown"), "audioCodec": audio.get("codec_name", "unknown")}


def probe_media(file: Path, directory: Path):
    raw = run_media(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format",
                     "-show_streams", "-of", "json", str(file)], directory)
    try:
        return validate_probe(json.loads(raw))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise JobError("INVALID_MEDIA", "The video could not be inspected. Try exporting it again.") from None


def align_segments(segments, duration):
    """Validate Whisper timestamps against the exact playback audio timeline."""
    result = []
    previous = 0.0
    for segment in segments:
        start, end, text = float(segment["start"]), float(segment["end"]), segment["text"].strip()
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or start < previous or end > duration + 0.5:
            raise JobError("INVALID_TIMESTAMPS", "Speech recognition returned invalid timestamps. Please retry the recording.")
        end = min(end, duration)
        if text and end > start:
            result.append({"id": len(result), "start": round(start, 3), "end": round(end, 3), "text": text})
            previous = end
    if not result:
        raise JobError("NO_SPEECH", "No speech was detected. Try a video with clear spoken audio or select its language.")
    return result


def setup_health():
    health = {"status": "ready", "pythonVersion": sys.version.split()[0],
              "ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe")),
              "model": MODEL, "device": DEVICE}
    try:
        health["fasterWhisperVersion"] = importlib.metadata.version("faster-whisper")
        from faster_whisper import WhisperModel  # noqa: F401
    except (ImportError, importlib.metadata.PackageNotFoundError):
        health.update(status="setup_error", error="Install transcription/requirements.txt in the Python environment used by Relay.")
    if not health["ffmpeg"] or not health["ffprobe"]:
        health.update(status="setup_error", error="Install FFmpeg and add both ffmpeg and ffprobe to PATH, then restart Relay.")
    return health


def model_path():
    return Path(os.environ.get("RELAY_MODEL_PATH", str(ROOT / "models" / MODEL)))


def download_model():
    from faster_whisper.utils import download_model as download
    destination = model_path()
    destination.mkdir(parents=True, exist_ok=True)
    download(MODEL, output_dir=str(destination))
    print(f"Whisper {MODEL} model is cached locally.", flush=True)


class Worker:
    def __init__(self):
        self.model = None

    def get_model(self):
        if self.model is None:
            from faster_whisper import WhisperModel
            destination = model_path()
            if not (destination / "model.bin").exists():
                try:
                    download_model()
                except Exception as error:
                    print(f"Model download failed: {type(error).__name__}", file=sys.stderr, flush=True)
                    raise JobError("MODEL_DOWNLOAD_FAILED", "Could not download the local speech model. Run npm run model:download, check your connection, and retry.") from None
            try:
                self.model = WhisperModel(str(destination), device=DEVICE, compute_type=COMPUTE,
                                          cpu_threads=CONFIG["cpuThreads"], local_files_only=True)
            except Exception as error:
                print(f"Model load failed: {type(error).__name__}", file=sys.stderr, flush=True)
                raise JobError("MODEL_LOAD_FAILED", "The local speech model could not start. Check the model and CPU/GPU settings in the README, then retry.") from None
        return self.model

    def process(self, directory: Path):
        started = time.monotonic()
        marker = directory / ".processing"
        try:
            marker.touch(exist_ok=False)
            job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, FileExistsError):
            return
        try:
            check_cancel(directory)
            if job["status"] != "queued":
                return
            job["status"] = "processing"
            job["playbackReady"] = False
            emit(job, directory, "validation", "started", "Inspecting the uploaded video")
            source = directory / "source.video"
            if not source.exists() or source.stat().st_size > CONFIG["maxUploadBytes"]:
                raise JobError("INVALID_SOURCE", "The uploaded video is missing or exceeds the size limit. Upload it again.")
            job.update(probe_media(source, directory))
            emit(job, directory, "validation", "completed", "Video and audio tracks validated",
                 duration=job["duration"], width=job["width"], height=job["height"],
                 videoCodec=job["videoCodec"], audioCodec=job["audioCodec"])
            emit(job, directory, "extraction", "started", "Preparing browser playback and extracting mono audio")
            playback_temp = directory / "playback.part.mp4"
            playback = directory / "playback.mp4"
            audio = directory / "audio.wav"
            run_media(["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe",
                       "-i", str(source), "-map", "0:v:0", "-map", "0:a:0", "-threads", "2",
                       "-filter_threads", "2", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
                       "-af", "aresample=async=1:first_pts=0", "-c:v", "libx264", "-preset", "veryfast",
                       "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
                       str(playback_temp)], directory, max(600, job["duration"] * 2))
            prepared = probe_media(playback_temp, directory)
            os.replace(playback_temp, playback)
            job["duration"] = prepared["duration"]
            job["playbackReady"] = True
            run_media(["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe",
                       "-i", str(playback), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
                       "-c:a", "pcm_s16le", str(audio)], directory, 180)
            emit(job, directory, "extraction", "completed", "Playback prepared; 16 kHz mono audio extracted",
                 sampleRate=16000, channels=1, duration=job["duration"], playbackCodec="H.264 / AAC")
            job.update(model=MODEL, device=DEVICE)
            emit(job, directory, "recognition", "started", "Running local Whisper speech recognition",
                 model=MODEL, device=DEVICE, computeType=COMPUTE, requestedLanguage=job["requestedLanguage"])
            model = self.get_model()
            check_cancel(directory)
            segments, info = model.transcribe(str(audio), language=None if job["requestedLanguage"] == "auto" else job["requestedLanguage"],
                                              beam_size=5, vad_filter=True, condition_on_previous_text=False)
            recognized = []
            for segment in segments:
                check_cancel(directory)
                recognized.append({"start": segment.start, "end": segment.end, "text": segment.text})
            job["language"] = info.language
            job["languageProbability"] = info.language_probability
            emit(job, directory, "recognition", "completed", "Speech recognition finished",
                 language=info.language, languageProbability=info.language_probability, segmentCount=len(recognized))
            emit(job, directory, "alignment", "started", "Checking recognition timestamps against playback duration")
            job["segments"] = align_segments(recognized, job["duration"])
            emit(job, directory, "alignment", "completed", "Timestamped segments validated", segmentCount=len(job["segments"]))
            check_cancel(directory)
            job.update(status="completed", completedAt=now(), processingSeconds=round(time.monotonic() - started, 2))
            job.pop("error", None)
            emit(job, directory, "ready", "completed", "Transcript saved and ready to view", segmentCount=len(job["segments"]))
            print(f"Completed {job['id']}: {len(job['segments'])} segments, {info.language}", flush=True)
        except Cancelled:
            if directory.exists() and not (directory / ".delete").exists():
                job.update(status="queued", segments=[], playbackReady=False)
                emit(job, directory, job["stage"], "recovered", "Worker stopped; recording queued for restart")
        except Exception as error:
            if directory.exists() and not (directory / ".delete").exists():
                known = isinstance(error, JobError)
                job.update(status="failed", segments=[], error={"code": error.code if known else "TRANSCRIPTION_FAILED",
                           "message": str(error) if known else "Local transcription failed. Check the worker terminal, then retry."})
                emit(job, directory, job["stage"], "failed", job["error"]["message"], code=job["error"]["code"])
                print(f"Failed {job['id']}: {type(error).__name__}", file=sys.stderr, flush=True)
                if not known:
                    traceback.print_exc()
        finally:
            for name in ("audio.wav", "playback.part.mp4", ".processing"):
                (directory / name).unlink(missing_ok=True)
            if (directory / ".delete").exists():
                shutil.rmtree(directory, ignore_errors=True)


def acquire_lock():
    lock = ROOT / ".worker.lock"
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "w") as file:
                file.write(str(os.getpid()))
            atexit.register(lambda: lock.unlink(missing_ok=True))
            return
        except FileExistsError:
            try:
                pid = int(lock.read_text())
                # On Windows os.kill(pid, 0) is not a safe process existence check.
                if os.name == "nt":
                    import ctypes
                    from ctypes import wintypes
                    kernel = ctypes.windll.kernel32
                    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                    kernel.OpenProcess.restype = wintypes.HANDLE
                    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                    handle = kernel.OpenProcess(0x1000, False, pid)
                    if handle:
                        kernel.CloseHandle(handle)
                        raise RuntimeError("A Relay worker is already running for this data directory.")
                else:
                    os.kill(pid, 0)
                    raise RuntimeError("A Relay worker is already running for this data directory.")
            except (ProcessLookupError, ValueError):
                pass
            lock.unlink(missing_ok=True)
    raise RuntimeError("Could not acquire the worker lock.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-model", action="store_true")
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    health = setup_health()
    if options.check:
        print(json.dumps(health, indent=2))
        return 0 if health["status"] == "ready" else 1
    if options.download_model:
        download_model()
        return 0
    ROOT.mkdir(parents=True, exist_ok=True)
    videos = ROOT / "videos"
    videos.mkdir(exist_ok=True)
    acquire_lock()
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    def heartbeat():
        while not STOP.is_set():
            atomic_json(ROOT / "worker.json", {**health, "at": now()})
            STOP.wait(1)
    pulse = threading.Thread(target=heartbeat, daemon=True)
    pulse.start()
    # With the exclusive worker lock, all prior claims belong to a stopped worker.
    for directory in videos.glob("vid_*"):
        if (directory / ".delete").exists():
            shutil.rmtree(directory, ignore_errors=True)
            continue
        (directory / ".processing").unlink(missing_ok=True)
        (directory / "audio.wav").unlink(missing_ok=True)
        try:
            job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
            if job["status"] == "processing":
                job.update(status="queued", segments=[], playbackReady=False)
                emit(job, directory, "validation", "recovered", "Previous worker stopped; recording queued for recovery")
        except (FileNotFoundError, json.JSONDecodeError):
            continue
    print("Relay local transcription worker ready." if health["status"] == "ready" else health["error"], flush=True)
    worker = Worker()
    while not STOP.is_set():
        if health["status"] == "ready":
            queued = []
            for directory in videos.glob("vid_*"):
                if (directory / ".delete").exists():
                    shutil.rmtree(directory, ignore_errors=True)
                    continue
                # A request cleans partial uploads normally. After an HTTP process crash,
                # remove abandoned reservations without touching a current upload.
                try:
                    if not (directory / "job.json").exists() and time.time() - directory.stat().st_mtime > 3600:
                        shutil.rmtree(directory, ignore_errors=True)
                        continue
                    job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
                    if job["status"] == "queued":
                        queued.append((job["createdAt"], directory))
                except (FileNotFoundError, json.JSONDecodeError):
                    continue
            if queued:
                worker.process(min(queued)[1])
                continue
        STOP.wait(0.5)
    pulse.join(timeout=2)
    (ROOT / "worker.json").unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
