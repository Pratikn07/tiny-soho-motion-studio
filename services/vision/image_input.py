from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError


MIME_TO_FORMAT = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WEBP",
}


class ImageInputError(ValueError):
    pass


@dataclass(frozen=True)
class DecodedImage:
    data: bytes
    mimeType: str
    width: int
    height: int


def decode_image(data: bytes, mime_type: str, *, max_bytes: int, max_pixels: int) -> DecodedImage:
    if mime_type not in MIME_TO_FORMAT:
        raise ImageInputError("Only PNG, JPEG, and WebP images are supported.")
    if not data:
        raise ImageInputError("Image upload is empty.")
    if len(data) > max_bytes:
        raise ImageInputError("Image upload exceeds the configured size limit.")

    try:
        with Image.open(BytesIO(data)) as verified:
            image_format = verified.format
            width, height = verified.size
            if image_format != MIME_TO_FORMAT[mime_type]:
                raise ImageInputError("Image bytes do not match the declared MIME type.")
            if width < 1 or height < 1 or width * height > max_pixels:
                raise ImageInputError("Image dimensions exceed the configured pixel limit.")
            verified.verify()
        with Image.open(BytesIO(data)) as decoded:
            decoded.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        if isinstance(error, ImageInputError):
            raise
        raise ImageInputError("Image bytes could not be decoded.") from error
    return DecodedImage(data=data, mimeType=mime_type, width=width, height=height)
