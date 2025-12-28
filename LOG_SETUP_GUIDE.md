# Centralized Logging Setup Guide

This guide explains how to forward Render backend logs to Vercel so you can view all logs in one place.

## How It Works

1. **Vercel API Route** (`/api/render-logs.js`): Receives logs from Render backend
2. **Render Log Forwarder** (`server/utils/render-log-forwarder.js`): Sends logs from Render to Vercel
3. **Console Wrapper**: Automatically forwards all `console.log`, `console.error`, and `console.warn` calls

## Setup Steps

### Step 1: Deploy the API Route to Vercel

The API route is already created at `api/render-logs.js`. After you push to GitHub, Vercel will automatically deploy it.

### Step 2: Get Your Vercel Log Endpoint URL

After deployment, your log endpoint will be:
```
https://multiplayer-arcade.vercel.app/api/render-logs
```

### Step 3: Add Environment Variable to Render

1. Go to Render Dashboard → Your Service → Environment
2. Add new environment variable:
   - **Key**: `VERCEL_LOG_ENDPOINT`
   - **Value**: `https://multiplayer-arcade.vercel.app/api/render-logs`
3. Save (Render will auto-redeploy)

### Step 4: Verify It's Working

1. Check Render logs - you should see normal operation
2. Check Vercel function logs:
   - Go to Vercel Dashboard → Your Project → Functions
   - Click on `api/render-logs.js`
   - View logs - you should see Render logs appearing here

## Viewing Logs

### Option 1: Vercel Dashboard

1. Go to: https://vercel.com/jrizzo9s-projects/multiplayer-arcade
2. Click **"Functions"** tab
3. Click on `api/render-logs`
4. View logs in real-time

### Option 2: Vercel CLI

```bash
# View all function logs
npx vercel logs multiplayer-arcade

# View logs for specific function
npx vercel logs multiplayer-arcade --function api/render-logs

# Follow logs in real-time
npx vercel logs multiplayer-arcade --follow
```

### Option 3: Using AI Assistant

Once logs are forwarded to Vercel, I can read them using:
```bash
npx vercel logs multiplayer-arcade --function api/render-logs
```

## What Gets Logged

All console output from Render backend is forwarded:
- `console.log()` → Forwarded as "info" level
- `console.error()` → Forwarded as "error" level  
- `console.warn()` → Forwarded as "warn" level

Each log includes:
- Timestamp
- Service name ("render-backend")
- Log level
- Message
- Any additional metadata

## Troubleshooting

### Logs Not Appearing in Vercel

1. **Check Environment Variable**: Verify `VERCEL_LOG_ENDPOINT` is set in Render
2. **Check API Route**: Visit `https://multiplayer-arcade.vercel.app/api/render-logs` - should return 405 (Method Not Allowed) for GET requests
3. **Check Render Logs**: Look for any errors related to log forwarding
4. **Test Manually**: 
   ```bash
   curl -X POST https://multiplayer-arcade.vercel.app/api/render-logs \
     -H "Content-Type: application/json" \
     -d '{"level":"info","message":"Test log"}'
   ```

### Performance Considerations

- Log forwarding is **fire-and-forget** - it won't block your server
- If Vercel endpoint is down, Render will continue working normally
- Logs are sent asynchronously to avoid impacting performance

## Benefits

✅ **Centralized Logging**: All logs in one place (Vercel)  
✅ **Easy Access**: View via dashboard or CLI  
✅ **AI Readable**: I can read logs using Vercel CLI  
✅ **Non-Blocking**: Doesn't impact Render performance  
✅ **Automatic**: All console calls are automatically forwarded

---

**Note**: This setup forwards logs but doesn't store them permanently. For long-term log storage, consider integrating with a service like Logtail, Datadog, or similar.

