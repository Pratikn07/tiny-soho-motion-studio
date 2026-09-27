"""Restore immutable artwork around one reviewed motion area, without generative text."""
from __future__ import annotations
import math
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageOps
from services.vision.composition import video_dimensions


def rectangle(value: object) -> tuple[float, float, float, float]:
    if not isinstance(value, dict):
        raise ValueError("Invalid movement area.")
    try:
        x, y, w, h = (float(value[k]) for k in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("Invalid movement area.") from error
    if not all(math.isfinite(v) for v in (x,y,w,h)) or x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > 100.001 or y+h > 100.001:
        raise ValueError("Movement area must fit the image.")
    return x,y,w,h


def motion_overlay(source: bytes, plan: dict) -> bytes:
    with Image.open(BytesIO(source)) as raw:
        image=ImageOps.exif_transpose(raw)
        width,height=image.size
        if width*height > 40_000_000 or (width,height)!=(plan.get('width'),plan.get('height')):
            raise ValueError("Source dimensions do not match the reviewed plan.")
        artwork=image.convert('RGBA')
    x,y,w,h=rectangle(plan.get('region'))
    protected=plan.get('protectedRegions')
    if not isinstance(protected,list) or len(protected)>50:
        raise ValueError('Invalid protected areas.')
    for item in protected:
        px,py,pw,ph=rectangle(item)
        if x < px+pw+2 and x+w > px-2 and y < py+ph+2 and y+h > py-2:
            raise ValueError('Leave clearance around protected text.')
    left,top=math.ceil(x*width/100),math.ceil(y*height/100)
    right,bottom=math.floor((x+w)*width/100),math.floor((y+h)*height/100)
    if right-left<4 or bottom-top<4:
        raise ValueError('Movement area is too small.')
    alpha=Image.new('L',(width,height),255)
    # Feather exclusively inward. No generated pixels can escape this rectangle.
    feather=max(2,min(12,(right-left)//8,(bottom-top)//8))
    patch=Image.new('L',(right-left,bottom-top))
    patch.putdata([round(255*max(0,1-min(ix+1,iy+1,right-left-ix,bottom-top-iy)/feather))
                   for iy in range(bottom-top) for ix in range(right-left)])
    alpha.paste(patch,(left,top))
    artwork.putalpha(alpha)
    result=BytesIO(); artwork.save(result,format='PNG')
    return result.getvalue()


def compose_carousel(video: bytes, source: bytes, plan: dict, ffmpeg: str, ffprobe: str) -> tuple[bytes,int,int]:
    overlay=motion_overlay(source,plan)
    width,height=plan['width'],plan['height']
    # Even encoded dimensions without cropping or changing the source aspect ratio.
    multiplier=2 if width%2 or height%2 else 1
    out_width,out_height=width*multiplier,height*multiplier
    if out_width*out_height>16_000_000:
        raise ValueError('This image is too large for a Carousel export. Upload a smaller image at the same proportions.')
    with tempfile.TemporaryDirectory(prefix='tiny-soho-carousel-') as directory:
        folder=Path(directory)
        src,mask,out=folder/'source.mp4',folder/'overlay.png',folder/'result.mp4'
        src.write_bytes(video); mask.write_bytes(overlay)
        # WAN can choose a different pixel size; final geometry always comes from the source.
        command=[ffmpeg,'-v','error','-y','-i',str(src),'-loop','1','-i',str(mask),
          '-filter_complex',f'[0:v]scale={width}:{height},setsar=1[base];[base][1:v]overlay=0:0:format=auto:shortest=1,scale={out_width}:{out_height}:flags=neighbor,setsar=1[v]',
          '-map','[v]','-an','-t','5','-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart','-shortest',str(out)]
        subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=180)
        if video_dimensions(out,ffprobe_path=ffprobe)!=(out_width,out_height):
            raise ValueError('Export dimensions failed verification.')
        return out.read_bytes(),out_width,out_height
