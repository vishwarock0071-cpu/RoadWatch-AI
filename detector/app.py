"""RoadWatch AI pothole detector service.

A small FastAPI app wrapping an Ultralytics YOLOv8 model trained to find
potholes. The Node server sends each uploaded photo to POST /detect and gets
back bounding boxes, confidences and how much of the image the damage covers.

Run:  python detector/app.py          (listens on 127.0.0.1:8001)
"""
import io
import os
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("MODEL_PATH", HERE / "models" / "pothole.pt"))
CONF = float(os.environ.get("DETECT_CONF", "0.25"))
IMGSZ = int(os.environ.get("DETECT_IMGSZ", "640"))
MAX_BYTES = 15 * 1024 * 1024

app = FastAPI(title="RoadWatch AI detector")
_model = None
_model_error = None


def get_model():
    """Loads the YOLO model once, on first use."""
    global _model, _model_error
    if _model is not None:
        return _model
    if not MODEL_PATH.exists():
        _model_error = f"Model file not found at {MODEL_PATH}. Run the setup script (or python detector/download_model.py)."
        return None
    try:
        from ultralytics import YOLO

        _model = YOLO(str(MODEL_PATH))
        _model_error = None
    except Exception as e:  # noqa: BLE001
        _model_error = f"Could not load model: {e}"
    return _model


def model_name():
    return MODEL_PATH.stem if MODEL_PATH.exists() else None


@app.get("/health")
def health():
    m = get_model()
    if m is None:
        return JSONResponse(status_code=503, content={"ok": False, "detail": _model_error})
    return {"ok": True, "model": f"{model_name()} ({m.task})", "classes": list(m.names.values()), "conf": CONF}


def run_detection(img: Image.Image):
    m = get_model()
    if m is None:
        raise HTTPException(status_code=503, detail=_model_error)
    w, h = img.size
    t0 = time.perf_counter()
    res = m.predict(img, conf=CONF, imgsz=IMGSZ, retina_masks=True, verbose=False)[0]
    ms = round((time.perf_counter() - t0) * 1000)

    detections = []
    boxes = res.boxes
    masks = getattr(res, "masks", None)
    mask_data = masks.data.cpu().numpy() if masks is not None and masks.data is not None else None
    for i in range(len(boxes)):
        x1, y1, x2, y2 = [float(v) for v in boxes.xyxy[i].tolist()]
        conf = float(boxes.conf[i])
        label = m.names.get(int(boxes.cls[i]), str(int(boxes.cls[i])))
        box_ratio = max(0.0, (x2 - x1) * (y2 - y1)) / float(w * h)
        # Segmentation models give a pixel mask, which measures area better than the box.
        if mask_data is not None and i < len(mask_data):
            area_ratio = float(mask_data[i].sum()) / float(mask_data[i].size)
        else:
            area_ratio = box_ratio
        detections.append({
            "label": label,
            "confidence": round(conf, 4),
            "box": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            "box_norm": [round(x1 / w, 4), round(y1 / h, 4), round(x2 / w, 4), round(y2 / h, 4)],
            "area_ratio": round(area_ratio, 5),
        })
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return {
        "model": f"{model_name()} ({m.task})",
        "image": {"width": w, "height": h},
        "inference_ms": ms,
        "detections": detections,
    }


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large.")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")  # respect phone camera rotation
    except Exception:  # noqa: BLE001 — PIL/ultralytics raise several error types for bad files
        raise HTTPException(status_code=400, detail="File is not a readable image.")
    return run_detection(img)


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("DETECTOR_HOST", "127.0.0.1")
    port = int(os.environ.get("DETECTOR_PORT", "8001"))
    print(f"Loading model from {MODEL_PATH} ...")
    if get_model() is None:
        print(f"WARNING: {_model_error}")
    else:
        print(f"Model ready: {model_name()} · classes {list(_model.names.values())}")
    uvicorn.run(app, host=host, port=port, log_level="warning")
