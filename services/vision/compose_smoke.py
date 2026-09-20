"""Explicit local FFmpeg/FFprobe composition smoke; it never loads a model or calls a provider."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Mapping
from pathlib import Path

from PIL import Image, ImageDraw

from .composition import build_overlay_command, video_dimensions
from .config import VisionConfig


def _run(command: list[str]) -> None:
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("FFmpeg composition smoke could not complete.") from error


def run_smoke(env: Mapping[str, str] | None = None) -> dict[str, object]:
    environment = env or os.environ
    if environment.get("TINY_SOHO_RUN_COMPOSE_SMOKE") != "1":
        return {"status": "skipped", "reason": "Set TINY_SOHO_RUN_COMPOSE_SMOKE=1 to run the local FFmpeg/FFprobe composition smoke."}

    config = VisionConfig.from_env()
    with tempfile.TemporaryDirectory(prefix="tiny-soho-compose-smoke-") as temporary_directory:
        directory = Path(temporary_directory)
        raw_video = directory / "raw.mp4"
        overlay = directory / "overlay.png"
        final_video = directory / "final.mp4"
        width, height = 96, 128
        _run([
            config.ffmpeg_path,
            "-y",
            "-f", "lavfi",
            "-i", f"color=c=black:s={width}x{height}:r=30",
            "-t", "1",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(raw_video),
        ])
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((8, 8, width - 8, 24), fill=(255, 255, 255, 255))
        image.save(overlay, format="PNG")
        _run(build_overlay_command(raw_video, overlay, final_video, ffmpeg_path=config.ffmpeg_path))
        raw_dimensions = video_dimensions(raw_video, ffprobe_path=config.ffprobe_path)
        final_dimensions = video_dimensions(final_video, ffprobe_path=config.ffprobe_path)

        if raw_dimensions != (width, height) or final_dimensions != (width, height) or not final_video.is_file() or final_video.stat().st_size == 0:
            raise RuntimeError("FFmpeg composition smoke output metadata did not match the source fixture.")

        return {
            "status": "passed",
            "input": {"width": width, "height": height},
            "output": {"width": final_dimensions[0], "height": final_dimensions[1], "bytes": final_video.stat().st_size},
            "note": "Local FFmpeg/FFprobe composition only; no model inference, provider request, or download was made.",
        }


def main() -> None:
    print(json.dumps(run_smoke(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
