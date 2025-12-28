# 🚀 Render Deployment - Ready to Deploy!

## ✅ Pre-Deployment Checklist (COMPLETE)

- ✅ Code pushed to GitHub: https://github.com/jrizzo9/multiplayer-arcade
- ✅ `render.yaml` configured with correct settings
- ✅ Vercel frontend deployed: https://multiplayer-arcade.vercel.app
- ✅ Environment variables documented

## 🎯 Quick Deploy Steps (5 minutes)

### Option 1: Use Blueprint (Easiest - Recommended)

1. **Go to**: https://dashboard.render.com/blueprints
2. **Click**: "New Blueprint"
3. **Select**: "Public Git repository"
4. **Paste**: `https://github.com/jrizzo9/multiplayer-arcade`
5. **Click**: "Apply"
6. Render will automatically detect `render.yaml` and configure everything!

### Option 2: Manual Web Service Setup

1. **Go to**: https://dashboard.render.com/new/web-service
2. **Connect**: GitHub account (if not already connected)
3. **Select Repository**: `jrizzo9/multiplayer-arcade`
4. **Configure**:
   - **Name**: `multiplayer-arcade-server`
   - **Environment**: `Node`
   - **Region**: Choose closest
   - **Branch**: `main`
   - **Root Directory**: (leave empty)
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && npm start`
5. **Environment Variables** (click "Advanced"):
   ```
   PORT=8000
   CLIENT_URL=https://multiplayer-arcade.vercel.app
   NODE_ENV=production
   ```
6. **Click**: "Create Web Service"

## 📋 After Deployment

Once Render gives you a URL (e.g., `https://multiplayer-arcade-server.onrender.com`):

1. **Update Vercel Environment Variable**:
   - Go to: https://vercel.com/jrizzo9s-projects/multiplayer-arcade/settings/environment-variables
   - Add: `VITE_SERVER_URL` = `https://your-render-url.onrender.com`
   - Redeploy frontend

2. **Verify Connection**:
   - Visit: https://multiplayer-arcade.vercel.app
   - Check browser console for Socket.IO connection
   - Should see: `[Socket] Connected: <socket-id>`

## 🔗 Important URLs

- **GitHub Repo**: https://github.com/jrizzo9/multiplayer-arcade
- **Vercel Frontend**: https://multiplayer-arcade.vercel.app
- **Render Backend**: (Will be generated after deployment)

## ⚠️ Important Notes

1. **Free Tier Sleep**: Render free tier services sleep after 15 minutes of inactivity. First request may take 30-60 seconds to wake up.

2. **Database**: SQLite file is stored in server directory. For production, consider migrating to Render's managed PostgreSQL.

3. **CORS**: Already configured in `server/index.js` to accept requests from `https://multiplayer-arcade.vercel.app`

---

**Ready to deploy!** Use Option 1 (Blueprint) for the fastest setup.

