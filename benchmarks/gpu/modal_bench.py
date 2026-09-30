"""Disposable GPU benchmark: LTX-2.5 22B distilled on the Tiny Soho sample slides.

Run from the repository root (see benchmarks/gpu/README.md):
  modal run benchmarks/gpu/modal_bench.py::download   # one-time weight download, CPU only
  modal run benchmarks/gpu/modal_bench.py              # every slide x seed in one GPU container
  modal run benchmarks/gpu/modal_bench.py --slides layered.json   # background layers only (see animate_text.py)

LTX gets the whole still slide and the prompt; compose.py later restores only the protected text/brand boxes.
The model loads once, so the first clip includes warm-up. Only the slide images leave this machine; raw clips
come back to benchmarks/gpu/results/<timestamp>/ for compose.py.
"""
from __future__ import annotations
import datetime
import json
import time
from pathlib import Path
import modal

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1] if len(HERE.parents) > 1 else HERE  # Containers mount this file alone at /root.
GPU = "RTX-PRO-6000"  # Same Blackwell chip family as the RTX 5090, with 96 GB so nothing offloads.
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
FPS, FRAMES = 24, 121  # 121 frames at 24 fps is 5.04 s; the compositor trims to exactly 5 s.
TARGET_PIXELS = 768 * 960  # Round 1 size; every job keeps about this many pixels at its own aspect ratio.
SEEDS = (42, 7)

volume = modal.Volume.from_name("tiny-soho-models", create_if_missing=True)
app = modal.App("tiny-soho-gpu-bench")

download_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("huggingface_hub>=0.35")

ltx_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "ffmpeg", "build-essential")
    .run_commands(
        "pip install uv",
        f"git clone https://github.com/Lightricks/LTX-2.git /opt/LTX-2 && git -C /opt/LTX-2 checkout {LTX_COMMIT}",
        # The README's install command, into the image's own Python so Modal can import it directly.
        "cd /opt/LTX-2 && UV_PROJECT_ENVIRONMENT=/usr/local UV_PYTHON_DOWNLOADS=never "
        "uv sync --inexact --no-dev --extra natten",
    )
)


def generation_size(width: int, height: int) -> tuple[int, int]:
    """About TARGET_PIXELS at the input's aspect ratio, each side divisible by 64 (two-stage pipeline)."""
    scale = (TARGET_PIXELS / (width * height)) ** 0.5
    return max(256, round(width * scale / 64) * 64), max(256, round(height * scale / 64) * 64)


def jobs(slides: list[dict]) -> list[dict]:
    out = []
    for slide in slides:
        box = (0, 0, slide["width"], slide["height"])
        width, height = generation_size(slide["width"], slide["height"])
        for seed in SEEDS:
            out.append({"name": f"{slide['id']}-full-s{seed}", "slide": slide["id"], "mode": "full", "seed": seed,
                        "box": box, "width": width, "height": height, "prompt": slide["prompt"],
                        # Optional: the same still as a loose keyframe on the last frame, so the clip ends near
                        # its starting pose (the subject cannot wander off, and the clip loops).
                        "end_strength": slide.get("end_strength")})
    return out


@app.function(image=download_image, volumes={MODELS: volume}, secrets=[modal.Secret.from_name("huggingface")],
              cpu=4, memory=8192, timeout=7200)
def download() -> dict:
    """Cache weights in the Volume and time the download, which is what a volume-less cold start would pay."""
    from huggingface_hub import snapshot_download
    started = time.perf_counter()
    path = Path(snapshot_download("Lightricks/LTX-2.5", allow_patterns=LTX_FILES, local_dir=LTX_DIR))
    size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    volume.commit()
    report = {"seconds": round(time.perf_counter() - started, 1), "gib": round(size / 2**30, 1)}
    print(json.dumps(report))
    return report


@app.function(image=ltx_image, timeout=600)
def check_image() -> None:
    """CPU-only: build the LTX image and import the pipeline, so install problems surface before GPU time."""
    import torch
    from ltx_pipelines.distilled import DistilledPipeline  # noqa: F401
    print(f"ltx_pipelines import ok; torch {torch.__version__}, CUDA build {torch.version.cuda}")


@app.function(image=ltx_image, gpu=GPU, volumes={MODELS: volume}, timeout=3600)
def run_ltx(work: list[dict], images: dict[str, bytes]) -> dict:
    import tempfile
    from io import BytesIO
    import torch
    from PIL import Image, ImageOps
    from ltx_core.model.video_vae import get_video_chunks_number
    from ltx_pipelines.distilled import DistilledPipeline
    from ltx_pipelines.utils.media_io import encode_video
    from ltx_pipelines.utils.model_paths import ModelPaths
    from ltx_pipelines.utils.types import ImageConditioningInput
    started = time.perf_counter()
    pipe = DistilledPipeline(
        model_paths=ModelPaths.from_split(
            transformer_path=f"{LTX_DIR}/{LTX_FILES[0]}", text_encoder_path=f"{LTX_DIR}/{LTX_FILES[1]}",
            video_vae_path=f"{LTX_DIR}/{LTX_FILES[2]}", audio_vae_path=f"{LTX_DIR}/{LTX_FILES[3]}"),
        spatial_upsampler_path=f"{LTX_DIR}/{LTX_FILES[4]}", loras=())
    load_seconds = round(time.perf_counter() - started, 1)
    clips = []
    with tempfile.TemporaryDirectory() as tmp:
        for index, job in enumerate(work):
            image = Path(tmp) / f"{job['name']}.png"
            with Image.open(BytesIO(images[job["slide"]])) as raw:
                ImageOps.exif_transpose(raw).convert("RGB").crop(job["box"]).save(image)
            out = Path(tmp) / f"{job['name']}.mp4"
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            clip_started = time.perf_counter()
            error = None
            try:
                with torch.inference_mode():
                    result = pipe(prompt=job["prompt"], seed=job["seed"], height=job["height"], width=job["width"],
                                  frame_rate=FPS, num_frames=FRAMES,
                                  images=[ImageConditioningInput(str(image), 0, 1.0)] + (
                                      [ImageConditioningInput(str(image), FRAMES - 1, job["end_strength"])]
                                      if job.get("end_strength") else []))
                    # The compositor drops audio; LTX always generates it, so it is part of the measured cost.
                    encode_video(video=result.video, fps=FPS, audio=result.audio, output_path=str(out),
                                 video_chunks_number=get_video_chunks_number(result.num_frames, result.tiling_config))
                torch.cuda.synchronize()
            except Exception as exc:  # Keep going: one failed clip is a benchmark result, not a crash.
                error = f"{type(exc).__name__}: {exc}"
            clips.append({
                **{k: v for k, v in job.items() if k != "prompt"}, "order": index,
                "seconds": round(time.perf_counter() - clip_started, 1),
                "peak_allocated_gib": round(torch.cuda.max_memory_allocated() / 2**30, 2),
                "peak_reserved_gib": round(torch.cuda.max_memory_reserved() / 2**30, 2),
                "error": error, "video": out.read_bytes() if out.exists() and not error else None,
            })
            print(f"{job['name']} {job['width']}x{job['height']}: {clips[-1]['seconds']}s, "
                  f"peak {clips[-1]['peak_reserved_gib']} GiB, error={error}")
    report = {"model": "ltx-2.5-22b-distilled-bf16", "commit": LTX_COMMIT, "load_seconds": load_seconds,
              # Plain str: torch.__version__ is a TorchVersion, which cannot be unpickled without torch locally.
              "gpu": str(torch.cuda.get_device_name(0)), "torch": str(torch.__version__),
              "settings": {"frames": FRAMES, "fps": FPS, "seeds": list(SEEDS)},
              "prompts": {job["slide"]: job["prompt"] for job in work}, "clips": clips}
    # Also keep a copy in the Volume, so a failed return never loses paid GPU work.
    saved = Path(MODELS) / "bench-results" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    saved.mkdir(parents=True)
    for clip in clips:
        if clip["video"]:
            (saved / f"{clip['name']}.raw.mp4").write_bytes(clip["video"])
    (saved / "metrics.json").write_text(json.dumps({**report, "clips": [
        {k: v for k, v in c.items() if k != "video"} for c in clips]}, indent=2))
    volume.commit()
    print(f"saved to volume {saved.relative_to(MODELS)}")
    return report


@app.local_entrypoint()
def main(slides: str = "slides.json"):
    """--slides layered.json runs slides whose text is a separate layer (LTX then sees only the background)."""
    slides = json.loads((HERE / slides).read_text())
    work = jobs(slides)
    images = {slide["id"]: (REPO / slide["source"]).read_bytes() for slide in slides}
    out = HERE / "results" / datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    started = time.perf_counter()
    print(f"{len(work)} clips: " + ", ".join(f"{j['name']} {j['width']}x{j['height']}" for j in work))
    report = run_ltx.remote(work, images)
    out.mkdir(parents=True, exist_ok=True)
    for clip in report["clips"]:
        video = clip.pop("video")
        if video:
            (out / f"{clip['name']}.raw.mp4").write_bytes(video)
    (out / "metrics.json").write_text(json.dumps(report, indent=2))
    failed = [c["name"] for c in report["clips"] if c["error"]]
    print(f"Done on {report['gpu']}; failed: {failed or 'none'}")
    print(f"Round trip {round(time.perf_counter() - started)}s. Results: {out.relative_to(REPO)}")
    print(f"Next: uv run --no-project --with pillow python benchmarks/gpu/compose.py {out.relative_to(REPO)}")
