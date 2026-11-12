"""Downloads a pretrained YOLOv8 pothole model into detector/models/pothole.pt.

Default source: Hugging Face models by keremberke, trained on a public
Roboflow pothole dataset (segmentation, 1 class: "pothole").
Set MODEL_URL to use a different .pt file, or copy your own trained weights to
detector/models/pothole.pt and skip this script.
"""
import os
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "models" / "pothole.pt"

SOURCES = [
    os.environ.get("MODEL_URL"),
    "https://huggingface.co/keremberke/yolov8n-pothole-segmentation/resolve/main/best.pt",
    "https://huggingface.co/keremberke/yolov8s-pothole-segmentation/resolve/main/best.pt",
]


def fetch(url: str, dest: Path) -> bool:
    tmp = dest.with_suffix(".part")
    try:
        print(f"Downloading {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "RoadWatchAI-setup/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            got = 0
            while True:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if total:
                    print(f"\r  {got / 1e6:.1f} / {total / 1e6:.1f} MB", end="", flush=True)
        print()
        if tmp.stat().st_size < 1_000_000:
            raise ValueError("downloaded file is too small to be a model")
        tmp.replace(dest)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  failed: {e}")
        tmp.unlink(missing_ok=True)
        return False


def verify(path: Path) -> bool:
    try:
        from ultralytics import YOLO

        m = YOLO(str(path))
        print(f"Model OK · task={m.task} · classes={list(m.names.values())}")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"Model file could not be loaded: {e}")
        return False


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists() and "--force" not in sys.argv:
        print(f"Model already present at {OUT}")
        sys.exit(0 if verify(OUT) else 1)
    for url in [u for u in SOURCES if u]:
        if fetch(url, OUT) and verify(OUT):
            print(f"Saved to {OUT}")
            return
        OUT.unlink(missing_ok=True)
    print("\nCould not download a pothole model automatically.")
    print("Download best.pt manually from https://huggingface.co/keremberke/yolov8n-pothole-segmentation")
    print(f"and save it as {OUT}")
    sys.exit(1)


if __name__ == "__main__":
    main()
