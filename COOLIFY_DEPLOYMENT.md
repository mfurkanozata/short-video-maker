# Coolify Deployment Guide

## Dosyalar
- `docker-compose.coolify.yml` - Coolify için özel Docker Compose
- `coolify.env.example` - Environment variables template

## Coolify'da Deployment

### 1. New Service Oluştur
- Service Type: **Docker Compose**
- Repository: Bu repo'yu seç
- Docker Compose File: `docker-compose.coolify.yml`

### 2. Environment Variables
Coolify'da şu environment variable'ları ekle:

```env
PEXELS_API_KEY=your_actual_api_key_here
LANGUAGE=tr
WHISPER_MODEL=base
DOCKER=true
LOG_LEVEL=debug
CONCURRENCY=1
VIDEO_CACHE_SIZE_IN_BYTES=2097152000
DOMAIN=your-domain.com
NODE_ENV=production
```

### 3. Volumes (Önemli!)
Coolify otomatik olarak volumes oluşturacak:
- `video_data` - Video dosyaları
- `piper_models` - Piper TTS modelleri
- `whisper_models` - Whisper modelleri

### 4. Network Ayarları
- Network: `short-video-network` (otomatik oluşur)
- Port: `3123` (otomatik expose edilir)

### 5. Health Checks
- Piper TTS: 60 saniye start period, sonra 30s interval
- Short Creator: Piper TTS'e depend eder

## Özellikler

### 🔧 Coolify Optimizasyonları:
- **Persistent Volumes**: Data kaybı olmaz
- **Health Checks**: Servislerin sağlıklı başlamasını garanti eder
- **Automatic Restart**: Crash durumunda otomatik restart
- **Traefik Labels**: SSL certificate otomatik
- **Network Isolation**: Güvenli internal network

### 🚀 Production Ready:
- **Resource Limits**: Memory ve CPU optimizasyonu
- **Logging**: Structured JSON logs
- **Error Handling**: Network retry logic
- **Performance**: Video cache ve concurrency ayarları

## Troubleshooting

### DNS Resolution Error
Eğer `getaddrinfo EAI_AGAIN piper-tts` hatası alıyorsan:

1. **Service Dependencies**: `depends_on` ile piper-tts'in hazır olmasını bekle
2. **Health Check**: Piper TTS'in sağlıklı olduğundan emin ol
3. **Network**: Aynı network'te olduklarını kontrol et

### Logs
```bash
# Coolify'da logs sekmesinden takip et
# Veya CLI ile:
docker logs short-video-maker-short-creator-1 -f
docker logs short-video-maker-piper-tts-1 -f
```

## API Usage

Video oluşturmak için:
```bash
curl -X POST https://your-domain.com/api/short-video \
  -H "Content-Type: application/json" \
  -d '{
    "scenes": [
      {
        "text": "Merhaba bu test nasılsın", 
        "searchTerms": ["test"]
      }
    ],
    "config": {
      "music": "chill",
      "voice": "af_heart", 
      "orientation": "portrait"
    }
  }'
```

Video durumu kontrol:
```bash
curl https://your-domain.com/api/short-video/VIDEO_ID/status
```

Video indirme:
```bash
curl -o video.mp4 https://your-domain.com/api/short-video/VIDEO_ID
```
