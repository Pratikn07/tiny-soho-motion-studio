from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from pydantic import BaseModel, Field

from .artifacts.manager import ArtifactManager


class CompositionError(RuntimeError):
    pass


class CompositionUnavailable(CompositionError):
    pass


class CompositionValidationError(CompositionError):
    pass


class CompositionRequest(BaseModel):
    videoArtifactId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f-]{27}$")
    overlayArtifactId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f-]{27}$")


class CompositionArtifact(BaseModel):
    artifactId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f-]{27}$")


def build_overlay_command(video_path: Path, overlay_path: Path, output_path: Path, *, ffmpeg_path: str) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
        "-i", str(video_path),
        "-loop", "1",
        "-i", str(overlay_path),
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:shortest=1[v]",
        "-map", "[v]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        str(output_path),
    ]


def validate_overlay_dimensions(*, video_width: int, video_height: int, overlay_width: int, overlay_height: int) -> None:
    if video_width != overlay_width or video_height != overlay_height:
        raise CompositionValidationError("Typography overlay dimensions must match the video dimensions.")


def compose_typography_artifacts(
    manager: ArtifactManager,
    video_artifact_id: str,
    overlay_artifact_id: str,
    *,
    ffmpeg_path: str,
    ffprobe_path: str,
) -> CompositionArtifact:
    video = manager.metadata(video_artifact_id)
    overlay = manager.metadata(overlay_artifact_id)
    if video.mimeType != "video/mp4" or overlay.mimeType != "image/png":
        raise CompositionValidationError("Composition requires an MP4 video artifact and a PNG overlay artifact.")
    video_path = manager.file_path(video.id)
    overlay_path = manager.file_path(overlay.id)
    overlay_width, overlay_height = image_dimensions(overlay_path)
    video_width, video_height = video_dimensions(video_path, ffprobe_path=ffprobe_path)
    validate_overlay_dimensions(
        video_width=video_width,
        video_height=video_height,
        overlay_width=overlay_width,
        overlay_height=overlay_height,
    )

    descriptor, temporary_name = tempfile.mkstemp(prefix=".composition-", suffix=".mp4", dir=manager.root)
    os.close(descriptor)
    Path(temporary_name).unlink(missing_ok=True)
    try:
        command = build_overlay_command(video_path, overlay_path, Path(temporary_name), ffmpeg_path=ffmpeg_path)
        try:
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)
        except FileNotFoundError as error:
            raise CompositionUnavailable("FFmpeg or FFprobe is not available for local composition.") from error
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise CompositionError("Local typography composition failed.") from error
        output = Path(temporary_name).read_bytes()
        metadata = manager.write_bytes(kind="composed-video", mime_type="video/mp4", data=output)
        return CompositionArtifact(artifactId=metadata.id)
    finally:
        Path(temporary_name).unlink(missing_ok=True)


def image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def video_dimensions(path: Path, *, ffprobe_path: str) -> tuple[int, int]:
    command = [
        ffprobe_path,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        str(path),
    ]
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=20)
        stream = json.loads(completed.stdout)["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired, KeyError, IndexError, ValueError, json.JSONDecodeError) as error:
        raise CompositionUnavailable("FFmpeg or FFprobe is not available for local composition.") from error
