from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx
from PIL import Image
from io import BytesIO

from .config import HostedVisionConfig
from .finish import UUID
from .processor import VisionJob, VisionStorage


class VisionRepositoryError(RuntimeError):
    pass


class SupabaseVisionRepository:
    def __init__(self, config: HostedVisionConfig, client: httpx.Client | None = None) -> None:
        self.config = config
        self.client = client or httpx.Client(timeout=httpx.Timeout(60.0))
        self.headers = {
            "apikey": config.service_role_key,
            "Authorization": f"Bearer {config.service_role_key}",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = self.client.request(method, f"{self.config.supabase_url}{path}", headers=self.headers | kwargs.pop("headers", {}), **kwargs)
        except httpx.RequestError as error:
            raise VisionRepositoryError("Supabase Vision connection is temporarily unavailable.") from None
        if response.is_error:
            raise VisionRepositoryError("Supabase Vision storage is temporarily unavailable.")
        return response

    def claim_vision_job(self) -> VisionJob | None:
        response = self._request("POST", "/rest/v1/rpc/claim_creative_studio_vision_job", json={})
        payload = response.json()
        row = payload[0] if isinstance(payload, list) and payload else payload
        if not row:
            return None
        return VisionJob(
            id=row["id"],
            owner_user_id=row["owner_user_id"],
            project_id=row["project_id"],
            source_asset_id=row["source_asset_id"],
            operation=row["operation"],
            options=row.get("options", {}),
            input_asset_ids=row.get("input_asset_ids", []),
            worker_lease_id=row.get("worker_lease_id"),
        )

    def extend_job_lease(self, job: VisionJob) -> None:
        if not job.worker_lease_id:
            raise VisionRepositoryError("Vision job has no active lease.")
        # Download, CPU composition and upload can exceed the initial two-minute claim.
        response = self._request(
            "PATCH", "/rest/v1/creative_studio_vision_jobs",
            params={"id": f"eq.{job.id}", "owner_user_id": f"eq.{job.owner_user_id}", "worker_lease_id": f"eq.{job.worker_lease_id}", "status": "eq.running", "worker_lease_expires_at": f"gt.{datetime.now(UTC).isoformat()}"},
            headers={"Prefer": "return=representation"},
            json={"worker_lease_expires_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat()},
        )
        if not response.json():
            raise VisionRepositoryError("Vision job lease changed before processing.")

    def storage_for(self, job: VisionJob) -> "JobStorage":
        return JobStorage(self, job)

    def _owned_asset(self, job: VisionJob, asset_id: str) -> dict[str, Any]:
        response = self._request(
            "GET",
            "/rest/v1/creative_studio_assets",
            params={
                "select": "id,object_path,mime_type,name,project_id,owner_user_id",
                "id": f"eq.{asset_id}",
                "project_id": f"eq.{job.project_id}",
                "owner_user_id": f"eq.{job.owner_user_id}",
                "limit": "1",
            },
        )
        rows = response.json()
        if not isinstance(rows, list) or len(rows) != 1:
            raise VisionRepositoryError("Vision input asset is not available in this project.")
        return rows[0]

    def download_asset(self, job: VisionJob, asset_id: str) -> tuple[bytes, str, str]:
        asset = self._owned_asset(job, asset_id)
        signed = self._request(
            "POST",
            f"/storage/v1/object/sign/creative-studio/{quote(asset['object_path'], safe='/')}",
            json={"expiresIn": 300},
        ).json()
        signed_url = signed.get("signedURL") or signed.get("signedUrl")
        if not isinstance(signed_url, str):
            raise VisionRepositoryError("Vision input URL could not be signed.")
        url = signed_url if signed_url.startswith("http") else f"{self.config.supabase_url}/storage/v1{signed_url}"
        try:
            response = self.client.get(url, timeout=httpx.Timeout(60.0))
        except httpx.RequestError as error:
            raise VisionRepositoryError("Vision input download was interrupted.") from None
        if response.is_error or not response.content:
            raise VisionRepositoryError("Vision input could not be downloaded.")
        return response.content, asset["mime_type"], url

    def find_derived(self, job: VisionJob, object_path: str) -> str | None:
        rows = self._request(
            "GET",
            "/rest/v1/creative_studio_assets",
            params={"select": "id", "object_path": f"eq.{object_path}", "project_id": f"eq.{job.project_id}",
                    "owner_user_id": f"eq.{job.owner_user_id}", "limit": "1"},
        ).json()
        return rows[0]["id"] if isinstance(rows, list) and rows else None

    def upload_derived(self, job: VisionJob, object_path: str, data: bytes, mime_type: str, kind: str, *, overwrite: bool = False) -> str:
        """Upload and record one output. `overwrite` is for fixed take paths: a crashed attempt may have left the
        file without its asset row, and a concurrent attempt may record the row first (object_path is unique)."""
        self.extend_job_lease(job)
        uploaded = self._request(
            "POST",
            f"/storage/v1/object/creative-studio/{quote(object_path, safe='/')}",
            content=data,
            headers={"Content-Type": mime_type, "x-upsert": "true" if overwrite else "false"},
        )
        if uploaded.is_error:
            raise VisionRepositoryError("Vision output could not be uploaded.")
        width: int | None = None
        height: int | None = None
        if mime_type.startswith("image/"):
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
        asset_uuid = str(uuid.uuid4())
        self.extend_job_lease(job)
        try:
            created = self._create_asset(job, asset_uuid, object_path, data, mime_type, kind, width, height)
        except VisionRepositoryError:
            existing = self.find_derived(job, object_path) if overwrite else None
            if existing:
                return existing
            raise
        if not isinstance(created, list) or len(created) != 1:
            raise VisionRepositoryError("Vision output metadata could not be saved.")
        return created[0]["id"]

    def _create_asset(self, job: VisionJob, asset_uuid: str, object_path: str, data: bytes, mime_type: str, kind: str,
                      width: int | None, height: int | None) -> Any:
        return self._request(
            "POST",
            "/rest/v1/creative_studio_assets",
            headers={"Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "id": asset_uuid,
                "project_id": job.project_id,
                "owner_user_id": job.owner_user_id,
                "kind": kind,
                "name": object_path.rsplit("/", 1)[-1],
                "mime_type": mime_type,
                "object_path": object_path,
                "byte_size": len(data),
                "width": width,
                "height": height,
                "duration_seconds": None,
                "sha256": hashlib.sha256(data).hexdigest(),
                "provenance": {"source": "vision-hosted", "visionJobId": job.id, "toolVersion": self.config.service_version},
            },
        ).json()

    def complete_job(self, job: VisionJob, *, status: str, asset_ids: list[str], error_code: str | None, error_message: str | None, data: dict[str, object] | None = None) -> None:
        self.extend_job_lease(job)
        response = self._request(
            "PATCH",
            "/rest/v1/creative_studio_vision_jobs",
            params={"id": f"eq.{job.id}", "owner_user_id": f"eq.{job.owner_user_id}", "worker_lease_id": f"eq.{job.worker_lease_id}", "status": "eq.running", "worker_lease_expires_at": f"gt.{datetime.now(UTC).isoformat()}"},
            headers={"Content-Type": "application/json", "Prefer": "return=representation"},
            json={
                "status": status,
                "output_asset_ids": asset_ids,
                "error_code": error_code,
                "error_message": error_message,
                "worker_lease_id": None,
                "worker_lease_expires_at": None,
                "updated_at": datetime.now(UTC).isoformat(),
                # `result` exists only with the creation v2 migration, which is also what allows finish/check jobs.
                **({"result": data} if data is not None else {}),
            },
        )

        if not response.json():
            raise VisionRepositoryError("Vision lease changed before completion.")

    def upsert_capabilities(self) -> None:
        now = datetime.now(UTC).isoformat()
        rows = [
            {"capability_id": operation, "service_version": self.config.service_version, "status": "available", "reason": None, "refreshed_at": now, "updated_at": now}
            for operation in ("inspect", "overlay", "plate", "compose", "carousel_compose", "finish")
        ] + [
            {"capability_id": operation, "service_version": self.config.service_version, "status": "unavailable", "reason": "Not configured in the CPU-safe hosted Vision service.", "refreshed_at": now, "updated_at": now}
            for operation in ("ocr", "segment", "layers")
        ]
        self._request(
            "POST",
            "/rest/v1/creative_studio_vision_capabilities?on_conflict=capability_id",
            headers={"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows,
        )


@dataclass
class JobStorage(VisionStorage):
    repository: SupabaseVisionRepository
    job: VisionJob

    def download_owned_source(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]:
        if (owner_user_id, project_id, asset_id) != (self.job.owner_user_id, self.job.project_id, self.job.source_asset_id):
            raise VisionRepositoryError("Vision source ownership check failed.")
        return self.repository.download_asset(self.job, asset_id)

    def download_owned_input(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]:
        if owner_user_id != self.job.owner_user_id or project_id != self.job.project_id or asset_id not in self.job.input_asset_ids:
            raise VisionRepositoryError("Vision input ownership check failed.")
        return self.repository.download_asset(self.job, asset_id)

    def _allowed(self, object_path: str) -> bool:
        project = f"owners/{self.job.owner_user_id}/projects/{self.job.project_id}/"
        prefixes = [f"{project}vision/{self.job.id}/"]
        take_id = self.job.options.get("takeId")
        if self.job.operation == "finish" and isinstance(take_id, str) and UUID.match(take_id):
            prefixes.append(f"{project}takes/{take_id}/")
        return ".." not in object_path and any(object_path.startswith(prefix) for prefix in prefixes)

    def find_derived(self, object_path: str) -> str | None:
        if not self._allowed(object_path):
            raise VisionRepositoryError("Vision output path is outside the current project.")
        return self.repository.find_derived(self.job, object_path)

    def upload_derived(self, object_path: str, data: bytes, mime_type: str, kind: str, *, overwrite: bool = False) -> str:
        if not self._allowed(object_path):
            raise VisionRepositoryError("Vision output path is outside the current project.")
        return self.repository.upload_derived(self.job, object_path, data, mime_type, kind, overwrite=overwrite)
