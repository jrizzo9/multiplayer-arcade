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
  
  // Debug logging (only in development or if explicitly enabled)
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_API_URL) {
    console.log('[apiUrl] VITE_API_URL:', viteApiUrl)
    console.log('[apiUrl] VITE_SERVER_URL:', viteServerUrl)
  }
  
  if (viteApiUrl) {
    return viteApiUrl
  }
  
  // Check for server URL (for WebSocket connections)
  if (viteServerUrl) {
    return viteServerUrl
  }
  
  // In production (served over HTTPS), we shouldn't use HTTP
  // Check if we're on a production domain
  const hostname = window.location.hostname
  const isProduction = hostname.includes('vercel.app') || 
                       hostname.includes('onrender.com') ||
                       (hostname !== 'localhost' && hostname !== '127.0.0.1')
  
  // If we're in production (HTTPS) and no env var is set, disable client logging
  // to avoid mixed content errors (HTTPS page can't request HTTP resources)
  if (isProduction && window.location.protocol === 'https:') {
    // Return null to indicate logging should be disabled
    // This prevents mixed content errors
    return null
  }
  
  // Development: use HTTP on localhost (or HTTPS if page is HTTPS)
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${hostname}:8000`
}

/**
 * Check if API URL is available (not disabled)
 */
export function isApiUrlAvailable() {
  return getApiUrl() !== null
}

