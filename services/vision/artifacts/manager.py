from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ..schemas.artifacts import ArtifactMetadata


SAFE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "video/mp4",
    "application/json",
}

BYTE_WRITABLE_MIME_TYPES = SAFE_MIME_TYPES - {"video/mp4"}


class ArtifactError(RuntimeError):
    pass


class ArtifactNotFound(ArtifactError):
    pass


class ArtifactTooLarge(ArtifactError):
    pass


class ArtifactMimeTypeError(ArtifactError):
    pass


class ArtifactManager:
    def __init__(
        self,
        root: Path,
        *,
        ttl_seconds: int,
        max_bytes: int | None = None,
        max_upload_bytes: int | None = None,
        max_image_artifact_bytes: int | None = None,
        max_video_artifact_bytes: int | None = None,
    ) -> None:
        default_limit = max_bytes
        if default_limit is None and (max_upload_bytes is None or max_image_artifact_bytes is None or max_video_artifact_bytes is None):
            raise ValueError("ArtifactManager requires explicit upload, image artifact, and video artifact limits.")
        self.root = root.expanduser()
        self.ttl_seconds = ttl_seconds
        self.max_upload_bytes = max_upload_bytes if max_upload_bytes is not None else default_limit
        self.max_image_artifact_bytes = max_image_artifact_bytes if max_image_artifact_bytes is not None else default_limit
        self.max_video_artifact_bytes = max_video_artifact_bytes if max_video_artifact_bytes is not None else default_limit
        if self.max_upload_bytes is None or self.max_image_artifact_bytes is None or self.max_video_artifact_bytes is None:
            raise ValueError("Artifact limits must be configured.")
        self.max_bytes = self.max_image_artifact_bytes
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    @staticmethod
    def _artifact_id(value: str) -> str:
        try:
            parsed = uuid.UUID(value)
        except (ValueError, AttributeError) as error:
            raise ArtifactNotFound("Unknown artifact.") from error
        if str(parsed) != value:
            raise ArtifactNotFound("Unknown artifact.")
        return value

    def _data_path(self, artifact_id: str) -> Path:
        return self.root / f"{self._artifact_id(artifact_id)}.bin"

    def _metadata_path(self, artifact_id: str) -> Path:
        return self.root / f"{self._artifact_id(artifact_id)}.json"

    def _write_atomic(self, destination: Path, data: bytes) -> None:
        descriptor, temporary_name = tempfile.mkstemp(prefix=".artifact-", dir=self.root)
        try:
            with os.fdopen(descriptor, "wb") as temporary:
                temporary.write(data)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, destination)
        except BaseException:
            Path(temporary_name).unlink(missing_ok=True)
            raise

    def _metadata(self, *, kind: str, mime_type: str, size_bytes: int) -> ArtifactMetadata:
        artifact_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        return ArtifactMetadata(
            id=artifact_id,
            kind=kind,
            mimeType=mime_type,
            createdAt=created_at,
            expiresAt=created_at + timedelta(seconds=self.ttl_seconds),
            sizeBytes=size_bytes,
        )

    def _write_metadata(self, metadata: ArtifactMetadata) -> None:
        self._write_atomic(self._metadata_path(metadata.id), metadata.model_dump_json().encode("utf-8"))

    def create_temp_output_path(self, *, suffix: str) -> Path:
        descriptor, temporary_name = tempfile.mkstemp(prefix=".output-", suffix=suffix, dir=self.root)
        os.close(descriptor)
        return Path(temporary_name)

    def _assert_owned_file(self, source_path: Path) -> Path:
        try:
            source = source_path.resolve(strict=True)
            source.relative_to(self.root.resolve())
        except (FileNotFoundError, ValueError) as error:
            raise ArtifactError("Only sidecar-managed temporary output files can be adopted.") from error
        if not source.is_file():
            raise ArtifactError("Only regular files can be adopted as artifacts.")
        return source

    def _move_or_copy_atomic(self, source: Path, destination: Path) -> None:
        try:
            os.replace(source, destination)
            return
        except OSError:
            pass
        descriptor, temporary_name = tempfile.mkstemp(prefix=".artifact-", dir=self.root)
        temporary = Path(temporary_name)
        try:
            with source.open("rb") as input_file, os.fdopen(descriptor, "wb") as output_file:
                shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
                output_file.flush()
                os.fsync(output_file.fileno())
            os.replace(temporary, destination)
            source.unlink(missing_ok=True)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise

    def write_bytes(self, *, kind: str, mime_type: str, data: bytes) -> ArtifactMetadata:
        if mime_type not in BYTE_WRITABLE_MIME_TYPES:
            raise ArtifactMimeTypeError("Unsupported artifact MIME type.")
        if not data:
            raise ArtifactError("Artifacts cannot be empty.")
        if len(data) > self.max_image_artifact_bytes:
            raise ArtifactTooLarge("Artifact exceeds the configured size limit.")

        metadata = self._metadata(kind=kind, mime_type=mime_type, size_bytes=len(data))
        self._write_atomic(self._data_path(metadata.id), data)
        self._write_metadata(metadata)
        return metadata

    def adopt_file(self, *, kind: str, mime_type: str, source_path: Path) -> ArtifactMetadata:
        if mime_type != "video/mp4":
            raise ArtifactMimeTypeError("Only MP4 output files can be adopted.")
        source = self._assert_owned_file(source_path)
        size_bytes = source.stat().st_size
        if size_bytes < 1:
            raise ArtifactError("Artifacts cannot be empty.")
        if size_bytes > self.max_video_artifact_bytes:
            raise ArtifactTooLarge("Artifact exceeds the configured video size limit.")

        metadata = self._metadata(kind=kind, mime_type=mime_type, size_bytes=size_bytes)
        destination = self._data_path(metadata.id)
        try:
            self._move_or_copy_atomic(source, destination)
            self._write_metadata(metadata)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        return metadata

    def metadata(self, artifact_id: str) -> ArtifactMetadata:
        path = self._metadata_path(artifact_id)
        try:
            metadata = ArtifactMetadata.model_validate_json(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, ValueError) as error:
            raise ArtifactNotFound("Unknown artifact.") from error
        if metadata.expiresAt <= datetime.now(UTC):
            self._delete(metadata.id)
            raise ArtifactNotFound("Artifact has expired.")
        return metadata

    def read_bytes(self, artifact_id: str) -> bytes:
        metadata = self.metadata(artifact_id)
        try:
            data = self._data_path(metadata.id).read_bytes()
        except FileNotFoundError as error:
            raise ArtifactNotFound("Unknown artifact.") from error
        if len(data) != metadata.sizeBytes:
            raise ArtifactNotFound("Artifact content is invalid.")
        return data

    def file_path(self, artifact_id: str) -> Path:
        metadata = self.metadata(artifact_id)
        path = self._data_path(metadata.id)
        if not path.is_file():
            raise ArtifactNotFound("Unknown artifact.")
        return path

    def _delete(self, artifact_id: str) -> None:
        self._data_path(artifact_id).unlink(missing_ok=True)
        self._metadata_path(artifact_id).unlink(missing_ok=True)

    def cleanup_expired(self, *, now: datetime | None = None) -> list[str]:
        current_time = now or datetime.now(UTC)
        removed: list[str] = []
        for metadata_path in self.root.glob("*.json"):
            try:
                metadata = ArtifactMetadata.model_validate_json(metadata_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if metadata.expiresAt <= current_time:
                self._delete(metadata.id)
                removed.append(metadata.id)
        return sorted(removed)
