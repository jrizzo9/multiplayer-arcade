/**
 * Utility to get the correct API/Server URL
 * Handles both development and production environments
 * Uses HTTPS when page is served over HTTPS
 */

export function getApiUrl() {
  // Check for environment variable first (for production)
  // Vite env vars are embedded at build time, so they should be available
  const viteApiUrl = import.meta.env.VITE_API_URL
  const viteServerUrl = import.meta.env.VITE_SERVER_URL
  
  if (viteApiUrl) {
    return viteApiUrl
  }
  
  // Check for server URL (for WebSocket connections)
  if (viteServerUrl) {
    return viteServerUrl
  }
  
  // In production (Vercel), use Render server URL
  // In development, default to Render server (can override with VITE_SERVER_URL for localhost)
  const hostname = window.location.hostname
  const isProduction = hostname.includes('vercel.app') || hostname.includes('onrender.com')
  
  if (isProduction) {
    // Production: backend is on Render
    return 'https://multiplayer-arcade-server.onrender.com'
  }
  
  // Development: default to Render server (external)
  // To use localhost instead, set VITE_SERVER_URL=http://localhost:8000 in .env
  return 'https://multiplayer-arcade-server.onrender.com'
}

/**
 * Check if API URL is available (not disabled)
 */
export function isApiUrlAvailable() {
  return getApiUrl() !== null
}

