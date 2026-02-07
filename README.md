# bomr

Sydney (Terrey Hills) weather radar GIF service. Downloads radar images from the Bureau of Meteorology FTP server, composites them with map layers, and serves an animated GIF.

## Usage

### Docker

```bash
docker compose up -d
curl http://localhost:7777/
```

### Local

```bash
pnpm install
pnpm serve
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Animated radar GIF |
| `/radar.gif` | GET | Animated radar GIF |
| `/health` | GET | Health check |
| `/status` | GET | Detailed status |
| `/refresh` | POST | Trigger regeneration |

## Configuration

Defaults are set in `src/server.ts`:

- **Port**: 7777
- **Radar range**: 512km
- **Frame delay**: 350ms
- **Schedule**: Hourly, 6AM-2AM Sydney time
