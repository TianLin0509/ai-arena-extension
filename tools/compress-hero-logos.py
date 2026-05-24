"""把 codex 画的 10 张 ~2MB 卡片 PNG 压成 ~256×360 WebP 给扩展用。"""
from pathlib import Path
from PIL import Image

SRC = Path(r"C:\Users\lintian\.claude-session-hub\images\ai-arena-logo-cards-20260524")
DST = Path(__file__).resolve().parent.parent / "src" / "icons" / "heroes"
DST.mkdir(parents=True, exist_ok=True)

# 文件名映射：原 PNG 名 → 输出 webp 名（小写匹配 service id）
MAPPING = {
    "Claude.png":   "claude.webp",
    "Gemini.png":   "gemini.webp",
    "GPT.png":      "chatgpt.webp",
    "DeepSeek.png": "deepseek.webp",
    "Doubao.png":   "doubao.webp",
    "Qwen.png":     "qwen.webp",
    "Kimi.png":     "kimi.webp",
    "Yuanbao.png":  "yuanbao.webp",
    "Grok.png":     "grok.webp",
    "Huawei.png":   "huawei.webp",
}

# 目标最大边 — 卡槽显示尺寸约 120px，2x retina + 一点余量
MAX_SIDE = 320
WEBP_QUALITY = 82

total_in = 0
total_out = 0
for src_name, dst_name in MAPPING.items():
    src_path = SRC / src_name
    dst_path = DST / dst_name
    if not src_path.exists():
        print(f"!! missing: {src_path}")
        continue
    in_size = src_path.stat().st_size
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    scale = MAX_SIDE / max(w, h)
    if scale < 1:
        new_w = round(w * scale)
        new_h = round(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    img.save(dst_path, format="WEBP", quality=WEBP_QUALITY, method=6)
    out_size = dst_path.stat().st_size
    total_in += in_size
    total_out += out_size
    print(f"  {src_name:14s} {in_size//1024:>5}KB -> {dst_name:14s} {out_size//1024:>5}KB  ({img.size[0]}×{img.size[1]})")

print(f"\nTotal: {total_in//1024:>5}KB -> {total_out//1024:>5}KB  ({100*total_out/total_in:.1f}%)")
