# Değerlendirme servisi (pipeline/ondemand/serve.py). Google Cloud Run'a deploy/cloud-run.ps1 ile yüklenir; PORT'u Cloud Run verir.
# Yerel deneme: docker build -t sebekesel-servis . ; docker run -p 7860:7860 sebekesel-servis → http://localhost:7860/api/health
FROM python:3.12-slim

# lightgbm OpenMP (libgomp1), rasterio içindeki GDAL libexpat ister
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libexpat1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-serve.txt .
RUN pip install --no-cache-dir -r requirements-serve.txt

COPY model/model_v2.txt model/model_v2.txt
COPY pipeline/ondemand/evaluate.py pipeline/ondemand/serve.py pipeline/ondemand/
# serve.py web/ klasörünü de sunar; serviste yalnızca /api/ kullanılır
RUN mkdir -p web

# numba önbelleği yazılabilir bir yerde olmalı
ENV HOST=0.0.0.0 PORT=7860 PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/tmp/numba
EXPOSE 7860
CMD ["python", "pipeline/ondemand/serve.py"]
