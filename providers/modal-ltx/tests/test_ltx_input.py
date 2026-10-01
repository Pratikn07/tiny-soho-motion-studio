import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ltx_input  # noqa: E402
from ltx_input import InputError, download, parse, upload  # noqa: E402

TAKE = "66666666-6666-4666-8666-666666666666"


def payload(**changes):
    base = {"idempotencyKey": TAKE, "modelId": "ltx-2.5-distilled", "backgroundUrl": "https://db.example/sign/bg?token=x",
            "outputUploadUrl": "https://db.example/upload/sign/raw.mp4?token=y", "prompt": "She smiles.", "seed": 42,
            "width": 768, "height": 960, "frames": 121, "fps": 24, "endFrame": {"strength": 0.6}}
    return base | changes


def test_valid_input_matches_the_benchmark_settings():
    job = parse(payload())
    assert (job.width, job.height, job.frames, job.fps, job.end_strength, job.seed) == (768, 960, 121, 24, 0.6, 42)
    assert parse(payload(endFrame=None)).end_strength is None
    assert parse(payload(endFrame={"strength": 0})).end_strength is None
    assert parse(payload(prompt="x" * 5000)).prompt == "x" * 5000
    assert parse({k: v for k, v in payload().items() if k not in ("frames", "fps")}).frames == 121


@pytest.mark.parametrize("sizes", [(640, 1152), (832, 832), (960, 768)])  # 9:16, 1:1, 5:4 at ~0.74 MP.
def test_other_ratios_at_multiples_of_64_are_accepted(sizes):
    assert parse(payload(width=sizes[0], height=sizes[1])).width == sizes[0]


@pytest.mark.parametrize("change, code", [
    ({"width": 770}, "model_unsupported_for_slide"),
    ({"width": 1536, "height": 1536}, "model_unsupported_for_slide"),
    ({"width": 128}, "ltx_input_invalid"),
    ({"frames": 120}, "ltx_input_invalid"),
    ({"seed": -1}, "ltx_input_invalid"),
    ({"seed": True}, "ltx_input_invalid"),
    ({"endFrame": {"strength": 1.5}}, "ltx_input_invalid"),
    ({"prompt": "  "}, "ltx_input_invalid"),
    ({"prompt": "x" * 5001}, "ltx_input_invalid"),
    ({"idempotencyKey": "take-1"}, "ltx_input_invalid"),
    ({"backgroundUrl": "http://db.example/bg"}, "ltx_input_invalid"),
    ({"backgroundUrl": "https://user:pw@db.example/bg"}, "ltx_input_invalid"),
    ({"outputUploadUrl": "file:///etc/passwd"}, "ltx_input_invalid"),
    ({"modelId": ""}, "ltx_input_invalid"),
])
def test_invalid_input_is_refused_before_gpu_work(change, code):
    with pytest.raises(InputError) as error:
        parse(payload(**change))
    assert error.value.code == code


def test_host_allowlist(monkeypatch):
    monkeypatch.setenv("LTX_ALLOWED_URL_HOSTS", "db.example, other.example")
    assert parse(payload())
    with pytest.raises(InputError):
        parse(payload(backgroundUrl="https://evil.example/bg"))


class Response:
    def __init__(self, data=b"", status=200):
        self.data, self.status = data, status

    def read(self, limit):
        return self.data[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_download_limits_size_and_hides_transport_errors(monkeypatch):
    assert download("https://x", opener=lambda *a, **k: Response(b"png")) == b"png"
    with pytest.raises(InputError) as error:
        download("https://x", limit=2, opener=lambda *a, **k: Response(b"png"))
    assert error.value.code == "ltx_input_invalid"

    def broken(*args, **kwargs):
        raise OSError("connection reset https://x?token=secret")
    with pytest.raises(InputError) as error:
        download("https://x?token=secret", opener=broken)
    assert "secret" not in str(error.value) and error.value.__cause__ is None


def test_upload_puts_mp4_and_reports_failures():
    seen = {}

    def opener(request, timeout):
        seen.update(method=request.get_method(), type=request.get_header("Content-type"), size=len(request.data))
        return Response(status=200)
    upload("https://x", b"video", opener=opener)
    assert seen == {"method": "PUT", "type": "video/mp4", "size": 5}
    with pytest.raises(InputError) as error:
        upload("https://x", b"video", opener=lambda *a, **k: Response(status=403))
    assert error.value.code == "ltx_upload_failed"
