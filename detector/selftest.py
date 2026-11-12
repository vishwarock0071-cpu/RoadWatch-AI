"""Runs the detector once on public/reference_pothole.jpg and prints the result."""
import sys
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app  # noqa: E402

img_path = Path(__file__).resolve().parent.parent / "public" / "reference_pothole.jpg"
if app.get_model() is None:
    print("Self-test skipped:", app._model_error)
    sys.exit(1)
img = ImageOps.exif_transpose(Image.open(img_path)).convert("RGB")
out = app.run_detection(img)
print(f"Self-test on {img_path.name}: {len(out['detections'])} detection(s) in {out['inference_ms']} ms")
for d in out["detections"]:
    print(f"  {d['label']:<10} conf {d['confidence']:.2f}  covers {d['area_ratio'] * 100:.1f}% of image")
