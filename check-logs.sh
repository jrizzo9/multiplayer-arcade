#!/bin/bash

# Script to check server logs from Vercel and Render
# Usage: ./check-logs.sh [vercel|render|both]

set -e

PROJECT_NAME="multiplayer-arcade"
VERCEL_PROJECT="jrizzo9s-projects/multiplayer-arcade"
RENDER_SERVICE_NAME="multiplayer-arcade-server"

check_vercel_logs() {
  echo "=========================================="
  echo "Checking Vercel Logs"
  echo "=========================================="
  echo ""
  
  echo "Vercel logs can be accessed via:"
  echo ""
  echo "Option 1: Vercel Dashboard (Recommended)"
  echo "  1. Go to: https://vercel.com/$VERCEL_PROJECT"
  echo "  2. Click on 'Deployments' tab"
  echo "  3. Click on the latest deployment"
  echo "  4. Click on 'Functions' tab"
  echo "  5. Click on 'api/render-logs' to view logs"
  echo ""
  
  echo "Option 2: Vercel CLI (requires deployment URL)"
  echo "  First, get your deployment URL from the dashboard, then:"
  echo "  npx vercel logs <DEPLOYMENT_URL>"
  echo ""
  echo "  Or list recent deployments:"
  echo "  npx vercel ls $PROJECT_NAME"
  echo ""
  
  echo "Option 3: Check if you're logged in to Vercel"
  echo "  npx vercel whoami"
  echo ""
  
  echo "Would you like to check recent deployments? (y/n)"
  read -r response
  
  if [[ "$response" =~ ^[Yy]$ ]]; then
    echo ""
    echo "Fetching recent deployments..."
    npx vercel ls $PROJECT_NAME 2>&1 | head -20
    echo ""
    echo "To view logs for a specific deployment, use:"
    echo "  npx vercel logs <deployment-url>"
  fi
}

check_render_logs() {
  echo "=========================================="
  echo "Checking Render Logs"
  echo "=========================================="
  echo ""
  
  echo "Render doesn't have a CLI, but you can check logs via:"
  echo ""
  echo "Option 1: Render Dashboard (Recommended)"
  echo "  1. Go to: https://dashboard.render.com"
  echo "  2. Navigate to your service: $RENDER_SERVICE_NAME"
  echo "  3. Click on 'Logs' tab"
  echo "  4. View real-time logs"
  echo ""
  
  echo "Option 2: Render API (requires API key)"
  echo "  You can use the Render API to fetch logs programmatically"
  echo "  See: https://render.com/docs/api"
  echo ""
  
  echo "Option 3: Check if logs are being forwarded to Vercel"
  echo "  If VERCEL_LOG_ENDPOINT is set in Render, logs should appear in Vercel"
  echo "  Run: npx vercel logs $PROJECT_NAME --function api/render-logs"
  echo ""
  
  echo "Note: Render logs are also forwarded to Vercel if configured."
  echo "Check Vercel logs to see Render backend logs."
}

check_both() {
  echo "=========================================="
  echo "Checking Both Vercel and Render Logs"
  echo "=========================================="
  echo ""
  
  check_vercel_logs
  echo ""
  echo ""
  check_render_logs
}

# Main script
case "${1:-both}" in
  vercel)
    check_vercel_logs
    ;;
  render)
    check_render_logs
    ;;
  both)
    check_both
    ;;
  *)
    echo "Usage: $0 [vercel|render|both]"
    echo "  vercel  - Show Vercel log commands"
    echo "  render  - Show Render log instructions"
    echo "  both    - Show both (default)"
    exit 1
    ;;
esac

