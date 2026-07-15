# TRADEX AUTO - Key Generator Server

Backend API server for the TRADEX AUTO Chrome Extension licensing system.

## Deployment on Render.com

1. Create a GitHub repository with these files (`index.js`, `package.json`, `README.md`)
2. Go to [Render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Configure:
   - **Name**: `tradex-auto-server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add Environment Variable:
   - **Key**: `ADMIN_KEY`
   - **Value**: `TRADEX_AUTO_ADMIN_2026`
6. Click **Deploy**
7. Once deployed, copy your Render URL (e.g., `https://tradex-auto-server.onrender.com`)
8. Update `API_BASE_URL` in:
   - The extension's `content.js` (look for `API_BASE_URL` constant)
   - The admin dashboard's `index.html` (look for `API_BASE_URL` constant)

## API Endpoints

### Public Routes
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/api/validate` | Validate key + UID + device |
| `POST` | `/api/check-device` | Check device binding |

### Admin Routes (require `Authorization: Bearer <ADMIN_KEY>`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/generate` | Generate keys |
| `GET` | `/api/admin/keys` | List all keys |
| `GET` | `/api/admin/stats` | Dashboard statistics |
| `GET` | `/api/admin/export` | Export keys as CSV |
| `POST` | `/api/admin/deactivate` | Deactivate a key |
| `POST` | `/api/admin/set-expiry` | Change key expiry |
| `POST` | `/api/admin/link-uid` | Link/update UID for a key |

## Local Development

```bash
npm install
ADMIN_KEY=TRADEX_AUTO_ADMIN_2026 npm start
```

Server runs on `http://localhost:3000` by default.

## Data Storage

All keys are stored in `keys_data.json`. This file is auto-created on first run.
