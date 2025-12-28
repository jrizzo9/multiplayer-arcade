# Deployment Guide

This guide provides step-by-step instructions for deploying the Multiplayer Arcade application to Vercel (frontend) and Render (backend).

---

## Architecture Overview

- **Frontend:** React + Vite application deployed on Vercel
- **Backend:** Node.js + Express + Socket.IO server deployed on Render
- **Database:** SQLite (stored in server directory - requires persistent storage)

---

## Prerequisites

1. **Vercel Account:** Sign up at [vercel.com](https://vercel.com)
2. **Render Account:** Sign up at [render.com](https://render.com)
3. **GitHub Repository:** Your code should be in a GitHub repository

---

## Part 1: Deploy Backend to Render

### Step 1: Create New Web Service on Render

1. Log into [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Select the repository containing this project

### Step 2: Configure Render Service

**Service Settings:**
- **Name:** `multiplayer-arcade-server`
- **Environment:** `Node`
- **Region:** Choose closest to your users
- **Branch:** `main` (or your default branch)
- **Root Directory:** Leave empty (or set to `server` if you prefer)
- **Build Command:** `cd server && npm install`
- **Start Command:** `cd server && npm start`

### Step 3: Set Environment Variables in Render

In the Render dashboard, navigate to **Environment** section and add:

```
PORT=8000
CLIENT_URL=https://your-frontend-domain.vercel.app
NODE_ENV=production
```

**Important:** Replace `your-frontend-domain.vercel.app` with your actual Vercel frontend URL (you'll get this after deploying to Vercel).

### Step 4: Deploy

1. Click **"Create Web Service"**
2. Render will automatically build and deploy your backend
3. Wait for deployment to complete
4. **Copy the service URL** (e.g., `https://multiplayer-arcade-server.onrender.com`)

---

## Part 2: Deploy Frontend to Vercel

### Step 1: Import Project to Vercel

1. Log into [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository
4. Select the repository

### Step 2: Configure Vercel Project

**Project Settings:**
- **Framework Preset:** Vite
- **Root Directory:** `./` (root of repository)
- **Build Command:** `npm run build` (default)
- **Output Directory:** `dist` (default)
- **Install Command:** `npm install` (default)

### Step 3: Set Environment Variables in Vercel

In the Vercel project settings, go to **Settings** → **Environment Variables** and add:

```
VITE_SERVER_URL=https://your-render-backend-url.onrender.com
```

**Important:** Replace `your-render-backend-url.onrender.com` with the actual Render backend URL you copied in Part 1, Step 4.

**Note:** For WebSocket connections, use `wss://` instead of `https://` if your Render service supports it. Otherwise, use `https://` and Socket.IO will handle the upgrade.

### Step 4: Deploy

1. Click **"Deploy"**
2. Vercel will build and deploy your frontend
3. Wait for deployment to complete
4. **Copy the frontend URL** (e.g., `https://multiplayer-arcade.vercel.app`)

---

## Part 3: Update Environment Variables

After both services are deployed, you need to update the environment variables with the actual URLs:

### Update Render Backend

1. Go back to Render dashboard
2. Navigate to your service → **Environment**
3. Update `CLIENT_URL` with your actual Vercel frontend URL:
   ```
   CLIENT_URL=https://multiplayer-arcade.vercel.app
   ```
4. Save and redeploy (Render will auto-redeploy on environment variable changes)

### Update Vercel Frontend (if needed)

1. Go to Vercel dashboard
2. Navigate to your project → **Settings** → **Environment Variables**
3. Verify `VITE_SERVER_URL` is set correctly:
   ```
   VITE_SERVER_URL=https://multiplayer-arcade-server.onrender.com
   ```
4. If you changed it, trigger a new deployment

---

## Environment Variables Summary

### Render (Backend)

| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `8000` | Server port (Render may override this) |
| `CLIENT_URL` | `https://your-frontend.vercel.app` | Frontend URL for CORS |
| `NODE_ENV` | `production` | Environment mode |

### Vercel (Frontend)

| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_SERVER_URL` | `https://your-backend.onrender.com` | Backend WebSocket/API URL |

---

## Post-Deployment Checklist

- [ ] Backend deployed on Render and accessible
- [ ] Frontend deployed on Vercel and accessible
- [ ] `CLIENT_URL` in Render points to Vercel frontend URL
- [ ] `VITE_SERVER_URL` in Vercel points to Render backend URL
- [ ] Test frontend can connect to backend (check browser console)
- [ ] Test WebSocket connection (check Socket.IO connection logs)
- [ ] Test CORS (should not see CORS errors in browser console)

---

## Troubleshooting

### CORS Errors

**Symptom:** Browser console shows CORS errors when connecting to backend.

**Solution:**
1. Verify `CLIENT_URL` in Render matches your exact Vercel frontend URL (including `https://`)
2. Ensure no trailing slashes in URLs
3. Check that Render service has been redeployed after setting `CLIENT_URL`

### WebSocket Connection Failed

**Symptom:** Socket.IO connection fails or shows connection errors.

**Solution:**
1. Verify `VITE_SERVER_URL` in Vercel is set correctly
2. Check that the Render backend URL is accessible (visit it in browser)
3. Ensure Render service is running (not sleeping - free tier services sleep after inactivity)
4. Check browser console for specific error messages

### Database Issues

**Symptom:** Data not persisting or database errors.

**Solution:**
1. **Important:** SQLite database is stored in the server directory
2. On Render free tier, the filesystem is ephemeral - data may be lost on restarts
3. For production, consider migrating to PostgreSQL (Render offers managed PostgreSQL)
4. See database migration guide (to be created) for PostgreSQL setup

### Build Failures

**Frontend Build Fails:**
- Check that all dependencies are in `package.json`
- Verify Node.js version compatibility
- Check Vercel build logs for specific errors

**Backend Build Fails:**
- Ensure `server/package.json` has all required dependencies
- Check that `better-sqlite3` native module builds correctly (may need build tools)
- Review Render build logs

---

## Database Migration (Future)

For production use, consider migrating from SQLite to PostgreSQL:

1. **Render PostgreSQL:** Create a managed PostgreSQL database on Render
2. **Update `server/db.js`:** Replace SQLite with PostgreSQL client (e.g., `pg`)
3. **Update connection string:** Use `DATABASE_URL` environment variable
4. **Migrate schema:** Run database migrations to create tables

**Note:** This migration is recommended but not required for initial deployment.

---

## Quick Reference: Environment Variables

### Copy-Paste for Render Dashboard

```
PORT=8000
CLIENT_URL=https://your-frontend-domain.vercel.app
NODE_ENV=production
```

### Copy-Paste for Vercel Dashboard

```
VITE_SERVER_URL=https://your-backend-domain.onrender.com
```

**Remember:** Replace the placeholder URLs with your actual deployed URLs!

---

## Support

For issues specific to:
- **Vercel:** Check [Vercel Documentation](https://vercel.com/docs)
- **Render:** Check [Render Documentation](https://render.com/docs)
- **This Application:** Review `APP_INTRACTIONS.md` for technical details

---

**Last Updated:** 2025-01-27

