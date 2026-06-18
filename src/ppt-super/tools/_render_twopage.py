# _render_twopage.py — 用真实 PowerPoint COM 打开双页 pptx，确认 SlideCount=2 并导出两页 PNG
# 跑法: uv run --with pywin32 python _render_twopage.py
from pathlib import Path
import pythoncom
import win32com.client

OUT = Path(__file__).parent / "_e2e_out"
targets = ["_verify_twopage_tpl06.pptx", "_verify_twopage_tpl22.pptx", "_verify_tpl101.pptx"]
pythoncom.CoInitialize()
app = win32com.client.Dispatch("PowerPoint.Application")
for name in targets:
    p = OUT / name
    if not p.exists():
        print("缺文件", name); continue
    try:
        pres = app.Presentations.Open(str(p), ReadOnly=True, Untitled=False, WithWindow=False)
        n = pres.Slides.Count
        print(f"{name}: PowerPoint 解析出 {n} 页")
        for i in range(1, n + 1):
            png = OUT / f"{p.stem}_p{i}.png"
            pres.Slides(i).Export(str(png), "PNG", 1920, 1080)
            print(f"  → 导出第 {i} 页: {png.name}")
        pres.Close()
    except Exception as e:
        print("FAIL", name, str(e)[:160])
try:
    app.Quit()
except Exception:
    pass
print("done")
