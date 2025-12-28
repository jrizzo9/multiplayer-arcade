# Render Backend Troubleshooting

## Current Issue: Timeout Errors

The frontend is correctly configured and trying to connect to:
- `https://multiplayer-arcade-server.onrender.com`

But getting `ERR_TIMED_OUT` errors.

## Likely Causes

### 1. Service is Sleeping (Most Common - Free Tier)

Render free tier services **spin down after 15 minutes of inactivity**. The first request after spin-down takes 30-60 seconds to wake up.

**Solution:**
- Wait 30-60 seconds after the first request
- The service should wake up automatically
- Subsequent requests will be fast

### 2. Service Not Running

**Check Render Dashboard:**
1. Go to: https://dashboard.render.com
2. Click on `multiplayer-arcade-server`
3. Check the status:
   - **"Live"** = Running (may be sleeping)
   - **"Suspended"** = Needs attention
   - **"Build Failed"** = Deployment issue

### 3. Check Render Logs

1. In Render Dashboard → Your Service
2. Click **"Logs"** tab
3. Look for:
   - Build errors
   - Runtime errors
   - "Server running on port..." message
   - Any error messages

### 4. Verify Environment Variables

In Render Dashboard → Your Service → Environment:
- `PORT=8000` (Render may override this)
- `CLIENT_URL=https://multiplayer-arcade.vercel.app`
- `NODE_ENV=production`

### 5. Test Backend Directly

Try accessing these URLs directly in your browser:
- `https://multiplayer-arcade-server.onrender.com/health`
- `https://multiplayer-arcade-server.onrender.com/api/user-profiles`

If these timeout, the service is definitely sleeping or not running.

## Quick Fixes

### Option 1: Wait for Service to Wake Up
- Make a request and wait 30-60 seconds
- Service should wake up automatically

### Option 2: Manual Wake-Up
- Visit `https://multiplayer-arcade-server.onrender.com/health` in browser
- Wait for it to respond (may take up to 60 seconds)
- Then try the frontend again

### Option 3: Check Build Status
- If build failed, check logs for errors
- Common issues:
  - Missing dependencies
  - Build command errors
  - Port configuration issues

## Next Steps

1. Check Render Dashboard for service status
2. Review Render logs for errors
3. Test `/health` endpoint directly
4. If service is suspended, check why (usage limits, payment, etc.)

