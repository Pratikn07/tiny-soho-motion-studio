from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .config import HostedVisionConfig
from .processor import VisionProcessor, process_vision_job
from .repository import SupabaseVisionRepository, VisionRepositoryError


SERVICE_NAME = "tiny-soho-creative-vision"
SERVICE_VERSION = "0.1.0"
logger = logging.getLogger(__name__)


def configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def claim_and_process_once(repository: SupabaseVisionRepository, processor: VisionProcessor) -> bool:
    job = repository.claim_vision_job()
    if not job:
        return False
    try:
        result = process_vision_job(job, repository.storage_for(job), processor)
    except (VisionRepositoryError, ValueError, OSError):
        logger.exception("Vision job could not be processed")
        repository.complete_job(
            job,
            status="needs_attention",
            asset_ids=[],
            error_code="vision_processing_failed",
            error_message="Vision processing needs review before it can continue.",
        )
        return True
    repository.complete_job(
        job,
        status=result.status,
        asset_ids=result.asset_ids,
        error_code=result.error_code,
        error_message=result.error_message,
    )
    return True


def worker_loop(stop: threading.Event) -> None:
    try:
        config = HostedVisionConfig.from_env()
        repository = SupabaseVisionRepository(config)
        processor = VisionProcessor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe")
        repository.upsert_capabilities()
    except (ValueError, VisionRepositoryError):
        logger.exception("Vision worker is not configured")
        return
    while not stop.is_set():
        handled = False
        try:
            handled = claim_and_process_once(repository, processor)
            if not handled:
                repository.upsert_capabilities()
        except (ValueError, VisionRepositoryError):
            logger.exception("Vision worker tick failed")
        stop.wait(0.1 if handled else config.poll_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = threading.Event()
    thread = threading.Thread(target=worker_loop, args=(stop,), daemon=True, name="creative-vision-worker")
    if configured():
        thread.start()
    yield
    stop.set()
    thread.join(timeout=2)


app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "configured": configured(),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
