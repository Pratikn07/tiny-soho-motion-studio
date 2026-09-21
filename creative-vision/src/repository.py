from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx
from PIL import Image
from io import BytesIO

from .config import HostedVisionConfig
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
        response = self.client.request(method, f"{self.config.supabase_url}{path}", headers=self.headers | kwargs.pop("headers", {}), **kwargs)
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
        response = self.client.get(url, timeout=httpx.Timeout(60.0))
        if response.is_error or not response.content:
            raise VisionRepositoryError("Vision input could not be downloaded.")
        return response.content, asset["mime_type"], url

    def upload_derived(self, job: VisionJob, object_path: str, data: bytes, mime_type: str, kind: str) -> str:
        uploaded = self._request(
            "POST",
            f"/storage/v1/object/creative-studio/{quote(object_path, safe='/')}",
            content=data,
            headers={"Content-Type": mime_type, "x-upsert": "false"},
        )
        if uploaded.is_error:
            raise VisionRepositoryError("Vision output could not be uploaded.")
        width: int | None = None
        height: int | None = None
        if mime_type.startswith("image/"):
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
        asset_uuid = str(uuid.uuid4())
        created = self._request(
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
        if not isinstance(created, list) or len(created) != 1:
            raise VisionRepositoryError("Vision output metadata could not be saved.")
        return created[0]["id"]

    def complete_job(self, job: VisionJob, *, status: str, asset_ids: list[str], error_code: str | None, error_message: str | None) -> None:
        self._request(
            "PATCH",
            "/rest/v1/creative_studio_vision_jobs",
            params={"id": f"eq.{job.id}", "owner_user_id": f"eq.{job.owner_user_id}", "worker_lease_id": f"eq.{job.worker_lease_id}"},
            headers={"Content-Type": "application/json"},
            json={
                "status": status,
                "output_asset_ids": asset_ids,
                "error_code": error_code,
                "error_message": error_message,
                "worker_lease_id": None,
                "worker_lease_expires_at": None,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )

    def upsert_capabilities(self) -> None:
        now = datetime.now(UTC).isoformat()
        rows = [
            {"capability_id": operation, "service_version": self.config.service_version, "status": "available", "reason": None, "refreshed_at": now, "updated_at": now}
            for operation in ("inspect", "overlay", "plate", "compose")
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

    def upload_derived(self, object_path: str, data: bytes, mime_type: str, kind: str) -> str:
        expected_prefix = f"owners/{self.job.owner_user_id}/projects/{self.job.project_id}/vision/{self.job.id}/"
        if not object_path.startswith(expected_prefix):
            raise VisionRepositoryError("Vision output path is outside the current project.")
        return self.repository.upload_derived(self.job, object_path, data, mime_type, kind)
