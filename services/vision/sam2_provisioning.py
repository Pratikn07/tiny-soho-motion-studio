"""Explicit provisioning for the official SAM 2.1 tiny checkpoint outside Git."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class Sam2CheckpointSpec:
    model_id: str
    source_repository: str
    source_commit: str
    checkpoint_url: str
    code_license: str
    checkpoint_license: str
    expected_bytes: int


def checkpoint_spec() -> Sam2CheckpointSpec:
    return Sam2CheckpointSpec(
        model_id="sam2.1_hiera_tiny",
        source_repository="https://github.com/facebookresearch/sam2",
        source_commit="2b90b9f5ceec907a1c18123530e92e794ad901a4",
        checkpoint_url="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt",
        code_license="Apache-2.0",
        checkpoint_license="Apache-2.0",
        expected_bytes=156_008_466,
    )


def validate_destination(destination: Path) -> Path:
    resolved = destination.expanduser().resolve()
    try:
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return resolved
    raise ValueError("SAM 2 checkpoint destination must be outside the source repository.")


def _trusted_ssl_context() -> ssl.SSLContext:
    try:
        import certifi
    except ModuleNotFoundError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def provision(destination: Path, *, dry_run: bool = False) -> dict[str, object]:
    checkpoint = validate_destination(destination)
    spec = checkpoint_spec()
    if dry_run:
        return {"destination": str(checkpoint), "dryRun": True, "checkpoint": asdict(spec)}

    checkpoint.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{checkpoint.name}.", suffix=".part", dir=checkpoint.parent)
    size = 0
    try:
        with os.fdopen(descriptor, "wb") as temporary_file, urlopen(
            spec.checkpoint_url,
            timeout=60,
            context=_trusted_ssl_context(),
        ) as response:
            while chunk := response.read(CHUNK_SIZE):
                size += len(chunk)
                if size > spec.expected_bytes * 2:
                    raise ValueError("SAM 2 checkpoint download exceeded its configured size limit.")
                temporary_file.write(chunk)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        Path(temporary_name).replace(checkpoint)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise

    manifest = {
        "checkpoint": asdict(spec),
        "destination": str(checkpoint),
        "bytes": size,
        "sha256": _sha256(checkpoint),
        "provisionedAt": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = checkpoint.with_suffix(checkpoint.suffix + ".provisioning.json")
    temporary_manifest = manifest_path.with_suffix(manifest_path.suffix + ".part")
    temporary_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary_manifest.replace(manifest_path)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly provision the official SAM 2.1 tiny checkpoint outside Git.")
    parser.add_argument("--destination", required=True, type=Path, help="Checkpoint file path outside this repository.")
    parser.add_argument("--dry-run", action="store_true", help="Show the exact source and expected size without downloading.")
    arguments = parser.parse_args()
    print(json.dumps(provision(arguments.destination, dry_run=arguments.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
