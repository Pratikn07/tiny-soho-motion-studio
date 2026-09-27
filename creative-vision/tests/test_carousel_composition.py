import sys
import json
import subprocess
from io import BytesIO
from pathlib import Path
import pytest
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'creative-vision'))
sys.path.insert(0,str(ROOT))
from src.carousel import motion_overlay, compose_carousel

def png(size=(101,125)):
    image=Image.new('RGB',size,(230,210,180))
    for x in range(size[0]):
        for y in range(20): image.putpixel((x,y),(20,30,40))
    out=BytesIO(); image.save(out,format='PNG'); return out.getvalue()
PLAN={'width':101,'height':125,'region':{'x':30,'y':35,'width':50,'height':50},'protectedRegions':[{'x':0,'y':0,'width':100,'height':25}]}

def test_overlay_preserves_original_pixels_outside_motion_and_feathers_inward():
    overlay=Image.open(BytesIO(motion_overlay(png(),PLAN)))
    assert overlay.getpixel((10,10))==(20,30,40,255)
    assert overlay.getpixel((90,80))==(230,210,180,255)
    assert overlay.getpixel((55,75))[3]==0
    assert 0<overlay.getpixel((31,45))[3]<255

def test_invalid_motion_or_dimensions_fail_closed():
    with pytest.raises(ValueError): motion_overlay(png(),{**PLAN,'width':200})
    with pytest.raises(ValueError): motion_overlay(png(),{**PLAN,'region':{'x':30,'y':24,'width':50,'height':50}})
    with pytest.raises(ValueError): motion_overlay(png(),{**PLAN,'region':{'x':99,'y':35,'width':50,'height':50}})

def test_compose_keeps_source_ratio_and_static_text_with_different_video_size(tmp_path):
    video=tmp_path/'input.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=80x100:r=10:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
    data,w,h=compose_carousel(video.read_bytes(),png(),PLAN,'ffmpeg','ffprobe')
    out=tmp_path/'output.mp4'; out.write_bytes(data)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=width,height,display_aspect_ratio','-of','json',str(out)]))['streams'][0]
    assert w/h==101/125
    assert (probe['width'],probe['height'])==(w,h)
    frame=tmp_path/'frame.png'
    subprocess.run(['ffmpeg','-v','error','-i',str(out),'-frames:v','1',str(frame)],check=True)
    decoded=Image.open(frame).convert('RGB')
    assert max(abs(a-b) for a,b in zip(decoded.getpixel((20,20)),(20,30,40)))<12
    assert decoded.getpixel((110,150))[0]>200
