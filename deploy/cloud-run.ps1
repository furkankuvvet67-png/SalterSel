# Değerlendirme servisini Google Cloud Run'a yükler (Dockerfile ile, Cloud Build üzerinden; yerelde Docker gerekmez).
# Bir kez: gcloud kurun (https://cloud.google.com/sdk/docs/install), sonra
#   gcloud auth login
#   gcloud projects create sebekesel-<rastgele>   (ya da var olan bir proje)
#   faturalandırma hesabını projeye bağlayın (console.cloud.google.com > Billing)
# Kullanım (depo kökünden): .\deploy\cloud-run.ps1 -Proje sebekesel-xxxx
param(
  [Parameter(Mandatory = $true)][string]$Proje,
  [string]$Bolge = 'europe-west1',      # ücretsiz kotanın geçerli olduğu 1. kademe bölge
  [string]$Servis = 'sebekesel-servis'
)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

function Calistir([scriptblock]$k) { & $k; if ($LASTEXITCODE -ne 0) { throw "Komut başarısız (çıkış $LASTEXITCODE)." } }

Calistir { gcloud config set project $Proje }
Calistir { gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com }

# Yeni projelerde varsayılan derleme hesabının (Compute Engine varsayılan hesabı) yetkisi yok: Cloud Run Builder rolü verilir.
$no = gcloud projects describe $Proje --format 'value(projectNumber)'
Calistir { gcloud projects add-iam-policy-binding $Proje --member "serviceAccount:$no-compute@developer.gserviceaccount.com" `
  --role roles/run.builder --condition=None --quiet --format none }

# max-instances 1: pencere önbelleği tek örnekte kalır ve maliyet sınırlı olur.
# min-instances 0: kullanılmadığında kapanır (ilk istek ~20-40 s soğuk başlangıç).
Calistir { gcloud run deploy $Servis --source . --region $Bolge --allow-unauthenticated `
  --memory 4Gi --cpu 2 --timeout 300 --concurrency 8 --min-instances 0 --max-instances 1 }

$url = gcloud run services describe $Servis --region $Bolge --format 'value(status.url)'
Write-Host ""
Write-Host "Servis: $url"
Write-Host "Deneme: $url/api/health"
Write-Host "vercel.json içindeki rewrite hedefini şuna çevirin: $url/api/:path*"
