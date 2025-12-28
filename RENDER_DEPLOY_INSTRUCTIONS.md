# Render Deployment - Quick Setup Guide

## Prerequisites
- GitHub repository (we'll set this up)
- Render account (sign up at https://render.com if needed)

## Step 1: Push to GitHub

Run these commands to create and push to GitHub:

```bash
# Create a new repository on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

**OR** if you prefer to use GitHub CLI:

```bash
gh repo create multiplayer-arcade --public --source=. --remote=origin --push
```

## Step 2: Deploy to Render via Web Dashboard

1. **Go to Render Dashboard**: https://dashboard.render.com
2. **Click "New +"** → **"Web Service"**
3. **Connect GitHub** (if not already connected)
4. **Select Repository**: Choose `multiplayer-arcade`
5. **Configure Service**:
   - **Name**: `multiplayer-arcade-server`
   - **Environment**: `Node`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Root Directory**: Leave empty (or set to `server`)
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && npm start`
6. **Environment Variables** (click "Advanced"):
   ```
   PORT=8000
   CLIENT_URL=https://multiplayer-arcade.vercel.app
   NODE_ENV=production
   ```
7. **Click "Create Web Service"**

## Step 3: Get Render URL and Update Vercel

After deployment completes:
1. Copy the Render service URL (e.g., `https://multiplayer-arcade-server.onrender.com`)
2. Go to Vercel Dashboard: https://vercel.com/jrizzo9s-projects/multiplayer-arcade/settings
3. Add Environment Variable:
   - **Key**: `VITE_SERVER_URL`
   - **Value**: `https://your-render-url.onrender.com`
4. Redeploy frontend (or wait for auto-deploy)

## Alternative: Use render.yaml (Blueprints)

If Render supports Blueprint deployments:
1. Go to Render Dashboard
2. Click "New +" → "Blueprint"
3. Connect your GitHub repo
4. Render will detect `render.yaml` and use those settings

---

**Current Vercel URL**: https://multiplayer-arcade.vercel.app  
**Render URL**: (Will be generated after deployment)

