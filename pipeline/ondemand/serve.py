"""Yerel değerlendirme servisi: web/ klasörünü sunar ve istek anında model çalıştırır.
python serve.py [PORT]   → http://localhost:8000/bolge.html
GET  /api/health
POST /api/eval     {"lat":..,"lon":..,"ring":[[lat,lon],..]?}  → HAND kademesi, AI skoru, AI bölgesi
GET  /api/overlay?lat=..&lon=..                                  → pencerenin kademe/AI ızgarası (çizim için)
İlk istek modülleri ve STAC kataloğunu yükler; yeni bir 20 km pencere ~5-15 s, aynı pencere anında.
"""
import sys, json, time, traceback
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

WEB = Path(__file__).resolve().parents[2] / "web"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print("model ve kütüphaneler yükleniyor…", flush=True)
import evaluate as E


class H(SimpleHTTPRequestHandler):
    def _cors(self):  # sayfa başka bir yerel sunucudan (ör. VS Code Live Server :5500) açılmış olabilir
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # yayımlanan https sayfası (ör. Vercel) yerel servise ulaşabilsin (Chrome Private Network Access)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self._cors(); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store"); self.end_headers()
        self.wfile.write(b)

    def _run(self, fn, *a):
        t = time.time()
        try:
            r = fn(*a); print(f"  {fn.__name__}{tuple(round(x, 4) for x in a[:2])} {time.time() - t:.1f} s", flush=True)
            self._json(200, r)
        except Exception as e:
            traceback.print_exc(); self._json(500, {"ok": False, "reason": f"Hesap başarısız: {e}"})

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/health": return self._json(200, {"ok": True, "model": "model_v2", "window_km": 2 * E.HALF / 1000})
        if u.path == "/api/overlay":
            q = parse_qs(u.query); return self._run(E.overlay, float(q["lat"][0]), float(q["lon"][0]))
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/eval": return self._json(404, {"ok": False})
        d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        lat, lon = float(d["lat"]), float(d["lon"])
        if not (35 <= lat <= 43 and 25 <= lon <= 45):
            return self._json(400, {"ok": False, "reason": "Konum Türkiye çevresinin dışında."})
        self._run(E.evaluate, lat, lon, d.get("ring"))

    def log_message(self, fmt, *a):
        if "/api/" in (a[0] if a else ""): return
        super().log_message(fmt, *a)


print(f"hazır: http://localhost:{PORT}/bolge.html", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), partial(H, directory=str(WEB))).serve_forever()
