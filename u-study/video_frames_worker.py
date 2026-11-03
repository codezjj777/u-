"""Decode a bounded set of video frames locally, without external protocols."""
import argparse
import json
import math
from pathlib import Path
import struct
import sys
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--count', type=int, default=12)
    args = parser.parse_args()
    import av
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if not source.is_file() or not 0 < source.stat().st_size <= 150 * 1024 * 1024 or not 1 <= args.count <= 12:
        raise ValueError('invalid media')
    output.mkdir(parents=True, exist_ok=True)
    frames = []
    with av.open(str(source), options={'protocol_whitelist': 'file,pipe,crypto,data'}) as container:
        if not container.streams.video or any(kind in container.format.name.split(',') for kind in ('hls', 'dash')):
            raise ValueError('unsupported video')
        stream = container.streams.video[0]
        duration = float(stream.duration * stream.time_base) if stream.duration and stream.time_base else float(container.duration or 0) / av.time_base
        if not math.isfinite(duration) or not 0 < duration <= 1800:
            raise ValueError('invalid duration')
        offset = float((stream.start_time or 0) * stream.time_base)
        for i in range(args.count):
            target = offset + duration * (i + 0.5) / args.count
            container.seek(int(target / stream.time_base), stream=stream, backward=True)
            selected = None
            for frame in container.decode(stream):
                selected = frame
                if frame.time is not None and float(frame.time) >= target:
                    break
            if selected is None or selected.time is None:
                raise ValueError('missing frame')
            scale = min(1, 640 / selected.width, 360 / selected.height)
            width, height = max(1, int(selected.width * scale)), max(1, int(selected.height * scale))
            pixels = selected.reformat(width=width, height=height, format='rgb24').to_ndarray()
            rows = b''.join(b'\x00' + pixels[y].tobytes() for y in range(height))
            png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b'')
            name = f'frame-{i:02d}.png'
            (output / name).write_bytes(png)
            frames.append({'file': name, 'time': round(max(0, float(selected.time) - offset), 3)})
    print(json.dumps({'ok': True, 'duration': duration, 'frames': frames}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'ok': False, 'code': 'video_frames_failed'}), flush=True)
        sys.exit(2)
