"""LTX-2.5 22B distilled image-to-video on Modal, as a deployed service for the creative worker.

  modal deploy providers/modal-ltx/app.py      # see README.md; nothing runs until the worker spawns a call

The worker spawns `Ltx.generate(input)` with T0's GenerationInput and polls the call id. The model loads once per
container (@modal.enter) and the container stays up for SCALEDOWN_SECONDS after the last call, so a 10-slide
carousel pays the load once, then the GPU is released. Ported from benchmarks/gpu/modal_bench.py.
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import modal

import ltx_input

APP_NAME = "tiny-soho-ltx"
GPU = "RTX-PRO-6000"  # 96 GB: the bf16 pipeline peaks at 42.5 GiB, too much for a 32 GB 5090.
MODELS = "/models"
LTX_DIR = f"{MODELS}/ltx-2.5"
LTX_COMMIT = "70ee118e0d0541056dc0e69e2e7c4baf9828326d"
LTX_FILES = [
    "diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    "text_encoders/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    "vae/ltx-2.5-video-vae-bf16.safetensors",
    "vae/ltx-2.5-audio-vae-bf16.safetensors",
    "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
]
SCALEDOWN_SECONDS = 120  # Long enough to go from one slide to the next in a batch.
MAX_CONTAINERS = int(os.environ.get("LTX_MAX_CONTAINERS", "1"))  # Read at deploy time; 1 keeps the budget safe.
CALL_TIMEOUT = 900

volume = modal.Volume.from_name("tiny-soho-models")  # Weights are already there; never download on a GPU.
done = modal.Dict.from_name("tiny-soho-ltx-takes", create_if_missing=True)  # take id -> result, for re-spawns.
app = modal.App(APP_NAME)

ltx_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "ffmpeg", "build-essential")
    .run_commands(
        "pip install uv",
        f"git clone https://github.com/Lightricks/LTX-2.git /opt/LTX-2 && git -C /opt/LTX-2 checkout {LTX_COMMIT}",
        "cd /opt/LTX-2 && UV_PROJECT_ENVIRONMENT=/usr/local UV_PYTHON_DOWNLOADS=never "
        "uv sync --inexact --no-dev --extra natten",
    )
    .env({"LTX_ALLOWED_URL_HOSTS": os.environ.get("LTX_ALLOWED_URL_HOSTS", "")})
    .add_local_python_source("ltx_input")
)


@app.cls(image=ltx_image, gpu=GPU, volumes={MODELS: volume}, timeout=CALL_TIMEOUT,
         scaledown_window=SCALEDOWN_SECONDS, max_containers=MAX_CONTAINERS)
class Ltx:
    @modal.enter()
    def load(self) -> None:
        from ltx_pipelines.distilled import DistilledPipeline
        from ltx_pipelines.utils.model_paths import ModelPaths
        started = time.perf_counter()
        self.pipe = DistilledPipeline(
            model_paths=ModelPaths.from_split(
                transformer_path=f"{LTX_DIR}/{LTX_FILES[0]}", text_encoder_path=f"{LTX_DIR}/{LTX_FILES[1]}",
                video_vae_path=f"{LTX_DIR}/{LTX_FILES[2]}", audio_vae_path=f"{LTX_DIR}/{LTX_FILES[3]}"),
            spatial_upsampler_path=f"{LTX_DIR}/{LTX_FILES[4]}", loras=())
        self.load_seconds: float | None = round(time.perf_counter() - started, 1)

    @modal.method()
    def generate(self, payload: dict) -> dict:
        """Render one take and upload it. Returns metadata only; known failures return {"ok": False, errorCode}."""
        try:
            job = ltx_input.parse(payload)
        except ltx_input.InputError as error:
            return {"ok": False, "errorCode": error.code, "message": str(error)}
        previous = done.get(job.idempotency_key)
        if previous:  # A re-spawn after a worker crash: the clip is already uploaded.
            return {**previous, "reused": True}
        try:
            result = self._render(job)
        except ltx_input.InputError as error:
            return {"ok": False, "errorCode": error.code, "message": str(error)}
        done[job.idempotency_key] = result
        return result

    def _render(self, job: ltx_input.Generation) -> dict:
        from io import BytesIO
        import torch
        from PIL import Image, ImageOps
        from ltx_core.model.video_vae import get_video_chunks_number
        from ltx_pipelines.utils.media_io import encode_video
        from ltx_pipelines.utils.types import ImageConditioningInput
        background = ltx_input.download(job.background_url)
        with tempfile.TemporaryDirectory(prefix="ltx-") as tmp:
            still, out = Path(tmp) / "background.png", Path(tmp) / "raw.mp4"
            try:
                with Image.open(BytesIO(background)) as raw:
                    ImageOps.exif_transpose(raw).convert("RGB").save(still)
            except OSError:
                raise ltx_input.InputError("ltx_input_invalid", "The background is not an image.") from None
            images = [ImageConditioningInput(str(still), 0, 1.0)]
            if job.end_strength:
                # The same background as a loose keyframe on the last frame: the subject stays put and it loops.
                images.append(ImageConditioningInput(str(still), job.frames - 1, job.end_strength))
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            try:
                with torch.inference_mode():
                    result = self.pipe(prompt=job.prompt, seed=job.seed, height=job.height, width=job.width,
                                       frame_rate=job.fps, num_frames=job.frames, images=images)
                    # LTX always makes audio; finishing drops it, but it is part of the measured cost.
                    encode_video(video=result.video, fps=job.fps, audio=result.audio, output_path=str(out),
                                 video_chunks_number=get_video_chunks_number(result.num_frames, result.tiling_config))
                torch.cuda.synchronize()
            except torch.cuda.OutOfMemoryError:
                torch.cuda.empty_cache()
                raise ltx_input.InputError("ltx_out_of_memory", "The GPU ran out of memory for this size.") from None
            gpu_seconds = round(time.perf_counter() - started, 1)
            ltx_input.upload(job.output_upload_url, out.read_bytes())
        load, self.load_seconds = self.load_seconds, None  # Report the model load once, on the first call.
        return {"ok": True, "uploaded": True, "gpuSeconds": gpu_seconds, "loadSeconds": load,
                "peakGib": round(torch.cuda.max_memory_reserved() / 2**30, 2), "seed": job.seed,
                "frames": job.frames, "width": job.width, "height": job.height,
                "gpu": str(torch.cuda.get_device_name(0))}


@app.function(image=ltx_image, timeout=600)
def check_image() -> str:
    """CPU only: build the image and import the pipeline, so install problems surface before any GPU time."""
    import torch
    from ltx_pipelines.distilled import DistilledPipeline  # noqa: F401
    import ltx_input as _  # noqa: F401
    return f"ltx_pipelines import ok; torch {torch.__version__}, CUDA build {torch.version.cuda}"
