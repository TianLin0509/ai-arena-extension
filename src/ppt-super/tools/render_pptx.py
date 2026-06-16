# pptx 第一页 → PNG（PowerPoint COM），看真实视觉效果（非 python-pptx 只读文字）
# 跑法：uv run --with pywin32 python render_pptx.py <pptx路径>
import sys
from pathlib import Path
import pythoncom
import win32com.client

P = Path(sys.argv[1])
OUT = P.with_suffix(".render.png")
pythoncom.CoInitialize()
app = win32com.client.Dispatch("PowerPoint.Application")
pres = app.Presentations.Open(str(P), ReadOnly=True, Untitled=False, WithWindow=False)
try:
    pres.Slides(1).Export(str(OUT), "PNG", 1920, 1080)
    print("rendered ->", OUT)
finally:
    pres.Close()
