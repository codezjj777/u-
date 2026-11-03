"""Local speech worker. Only setup downloads a public model; transcription is offline."""
import argparse
import json
import math
import os
from pathlib import Path
import sys


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("setup", "check", "transcribe"))
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--input")
    args = parser.parse_args()
    model_dir = Path(args.model_dir).resolve()
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        emit(ok=False, code="missing_dependencies")
        return 2
    if args.mode == "setup":
        from faster_whisper.utils import download_model
        emit(event="progress", stage="model_download")
        download_model("base.en", output_dir=str(model_dir), use_auth_token=False)
    if not all((model_dir / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")):
        emit(ok=False, code="missing_model")
        return 2
    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=min(4, os.cpu_count() or 2), local_files_only=True)
    if args.mode in ("setup", "check"):
        emit(ok=True, model="base.en", device="cpu", compute_type="int8")
        return 0
    import av
    media_path = Path(args.input).resolve()
    if not media_path.is_file() or media_path.stat().st_size > 150 * 1024 * 1024:
        emit(ok=False, code="invalid_media")
        return 2
    # Do not let a downloaded playlist make PyAV fetch URLs or open other files.
    with av.open(str(media_path), options={"protocol_whitelist": "file,pipe,crypto,data"}) as container:
        if not container.streams.audio:
            emit(ok=False, code="no_audio")
            return 2
        if any(name in container.format.name.split(",") for name in ("hls", "dash")):
            emit(ok=False, code="invalid_media")
            return 2
        duration = float(container.duration / av.time_base) if container.duration else 0
        if not duration:
            stream = container.streams.audio[0]
            duration = float(stream.duration * stream.time_base) if stream.duration and stream.time_base else 0
        if not math.isfinite(duration) or duration <= 0 or duration > 1800:
            emit(ok=False, code="media_too_long")
            return 2
    emit(event="progress", stage="transcribing", seconds=0)
    # Decode locally first, so the recognizer never sees the original URL.
    from faster_whisper.audio import decode_audio
    audio = decode_audio(str(media_path), sampling_rate=16000)
    duration = len(audio) / 16000
    if duration < 0.5 or duration > 1800:
        emit(ok=False, code="media_too_long" if duration > 1800 else "empty_audio")
        return 2
    segments, info = model.transcribe(audio, language="en", beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=True)
    output = []
    for segment in segments:
        value = segment.text.strip()
        if value and segment.no_speech_prob < 0.75 and segment.avg_logprob >= -1.1:
            output.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": value})
        emit(event="progress", stage="transcribing", seconds=round(segment.end), duration=round(duration))
    text = " ".join(item["text"] for item in output).strip()
    if len(text.split()) < (8 if duration > 15 else 3) or len(text) > 60000:
        emit(ok=False, code="unclear_audio")
        return 2
    emit(ok=True, text=text, language=info.language, duration=round(duration, 2), segments=output, model="base.en")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Paths, signed URLs and library tracebacks do not enter task logs.
        emit(ok=False, code="speech_failed")
        sys.exit(2)
