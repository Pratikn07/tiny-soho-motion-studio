"""Explicit, operator-invoked provisioning for the small licensed PaddleOCR v5 models.

This module is never imported by the FastAPI application. It refuses destinations
inside this repository so model checkpoints cannot accidentally enter Git.
"""

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
class PaddleModelSpec:
    model_id: str
    source_repository: str
    revision: str
    code_license: str
    model_license: str
    expected_bytes: int
    files: tuple[str, ...]
    expected_parameter_sha256: str | None = None

    def url_for(self, filename: str) -> str:
        return f"{self.source_repository}/resolve/{self.revision}/{filename}"


def mobile_model_specs() -> tuple[PaddleModelSpec, PaddleModelSpec]:
    return (
        PaddleModelSpec(
            model_id="PP-OCRv5_mobile_det",
            source_repository="https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det",
            revision="0d63e78e2b680928f6b1747d76a08db6e645efb7",
            code_license="Apache-2.0",
            model_license="Apache-2.0",
            expected_bytes=5_000_000,
            files=("config.json", "inference.json", "inference.pdiparams", "inference.yml"),
        ),
        PaddleModelSpec(
            model_id="en_PP-OCRv5_mobile_rec",
            source_repository="https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec",
            revision="267c36e24c331595590fe7bd72bde2436fd286f2",
            code_license="Apache-2.0",
            model_license="Apache-2.0",
            expected_bytes=8_000_000,
            files=("config.json", "inference.json", "inference.pdiparams", "inference.yml"),
            expected_parameter_sha256="3ec8a97ed6cefe8568d3e2ee90bb193299b566a7661aa4fd52d224b96b59f66b",
        ),
    )


def validate_destination(destination: Path) -> Path:
    resolved = destination.expanduser().resolve()
    try:
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return resolved
    raise ValueError("PaddleOCR model destination must be outside the source repository.")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def trusted_ssl_context() -> ssl.SSLContext:
    """Use certifi when available; never disable hostname or certificate checks."""
    try:
        import certifi
    except ModuleNotFoundError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def _download(url: str, destination: Path, maximum_bytes: int) -> int:
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".part", dir=destination.parent)
    size = 0
    try:
        with os.fdopen(file_descriptor, "wb") as temporary_file, urlopen(
            url,
            timeout=30,
            context=trusted_ssl_context(),
        ) as response:
            while chunk := response.read(CHUNK_SIZE):
                size += len(chunk)
                if size > maximum_bytes:
                    raise ValueError(f"Downloaded model file exceeded its configured limit: {destination.name}")
                temporary_file.write(chunk)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        Path(temporary_name).replace(destination)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return size


def provision(destination: Path, *, dry_run: bool = False) -> dict[str, object]:
    root = validate_destination(destination)
    specs = mobile_model_specs()
    total_expected_bytes = sum(spec.expected_bytes for spec in specs)
    if dry_run:
        return {
            "destination": str(root),
            "dryRun": True,
            "expectedBytes": total_expected_bytes,
            "models": [asdict(spec) for spec in specs],
        }

    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    records = []
    for spec in specs:
        model_root = root / spec.model_id
        files = []
        for filename in spec.files:
            target = model_root / filename
            maximum_bytes = max(spec.expected_bytes * 3, 2 * 1024 * 1024)
            size = _download(spec.url_for(filename), target, maximum_bytes)
            digest = _sha256(target)
            if filename == "inference.pdiparams" and spec.expected_parameter_sha256 and digest != spec.expected_parameter_sha256:
                raise ValueError(f"Pinned parameter checksum did not match for {spec.model_id}.")
            files.append({"name": filename, "bytes": size, "sha256": digest, "source": spec.url_for(filename)})
        records.append({"spec": asdict(spec), "files": files})

    manifest = {
        "profile": "v5-mobile",
        "provisionedAt": datetime.now(timezone.utc).isoformat(),
        "destination": str(root),
        "models": records,
    }
    manifest_path = root / "provisioning.json"
    temporary_path = manifest_path.with_suffix(".json.part")
    temporary_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary_path.replace(manifest_path)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicitly provision licensed PaddleOCR v5-mobile models outside Git.")
    parser.add_argument("--destination", required=True, type=Path, help="Owner-controlled directory outside this source repository.")
    parser.add_argument("--profile", default="v5-mobile", choices=("v5-mobile",))
    parser.add_argument("--dry-run", action="store_true", help="Show pinned sources and expected disk use without downloading.")
    arguments = parser.parse_args()
    print(json.dumps(provision(arguments.destination, dry_run=arguments.dry_run), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
