import subprocess, os, sys, re
EDGE = None
for c in [r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          r"C:/Program Files/Microsoft/Edge/Application/msedge.exe"]:
    if os.path.exists(c): EDGE = c; break
if not EDGE: print("未找到 Edge"); sys.exit(1)
target = sys.argv[1]; out = sys.argv[2]
url = f"http://localhost:8777/{target}"
profile = os.path.abspath("_edge_profile")
cmd = [EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
       f"--user-data-dir={profile}", "--virtual-time-budget=8000",
       "--dump-dom", url]
r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", timeout=120)
dom = r.stdout or ""
m = re.search(r'<div id="report"[^>]*>(.*?)</div>', dom, re.S)
report = m.group(1) if m else "(未找到 #report)"
report = report.replace("&lt;","<").replace("&gt;",">").replace("&amp;","&").replace("&quot;",'"')
with open(out,"w",encoding="utf-8") as f: f.write(report)
print("报告长度:", len(report))
