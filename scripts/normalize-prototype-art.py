from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    ROOT / "assets/prototype/fighters/volt/head.png": (384, 384),
    ROOT / "assets/prototype/neon-deck/background.png": (1280, 720),
}


for path, bounds in ASSETS.items():
    image = Image.open(path)
    image.thumbnail(bounds, Image.Resampling.LANCZOS)
    image.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)} -> {image.width}x{image.height}")
