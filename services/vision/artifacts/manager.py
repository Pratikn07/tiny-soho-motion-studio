from __future__ import annotations

import json
import os
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


class ArtifactError(RuntimeError):
    pass


class ArtifactNotFound(ArtifactError):
    pass


class ArtifactTooLarge(ArtifactError):
    pass


class ArtifactMimeTypeError(ArtifactError):
    pass


class ArtifactManager:
    def __init__(self, root: Path, *, ttl_seconds: int, max_bytes: int) -> None:
        self.root = root.expanduser()
        self.ttl_seconds = ttl_seconds
        self.max_bytes = max_bytes
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

    def write_bytes(self, *, kind: str, mime_type: str, data: bytes) -> ArtifactMetadata:
        if mime_type not in SAFE_MIME_TYPES:
            raise ArtifactMimeTypeError("Unsupported artifact MIME type.")
        if not data:
            raise ArtifactError("Artifacts cannot be empty.")
        if len(data) > self.max_bytes:
            raise ArtifactTooLarge("Artifact exceeds the configured size limit.")

        artifact_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        metadata = ArtifactMetadata(
            id=artifact_id,
            kind=kind,
            mimeType=mime_type,
            createdAt=created_at,
            expiresAt=created_at + timedelta(seconds=self.ttl_seconds),
            sizeBytes=len(data),
        )
        self._write_atomic(self._data_path(artifact_id), data)
        self._write_atomic(self._metadata_path(artifact_id), metadata.model_dump_json().encode("utf-8"))
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
