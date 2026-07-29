from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    ROOT / "assets/prototype/neon-deck/background.png": (1280, 720),
    ROOT / "assets/prototype/sky-rail/background.png": (1280, 720),
    ROOT / "assets/prototype/reactor-core/background.png": (1280, 720),
}

for path in (ROOT / "assets/prototype").glob("*/terrain/*.png"):
    ASSETS[path] = (512, 512)


for path, bounds in ASSETS.items():
    image = Image.open(path)
    image.thumbnail(bounds, Image.Resampling.LANCZOS)
    image.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)} -> {image.width}x{image.height}")
