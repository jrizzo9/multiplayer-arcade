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
  
  // Always use the same protocol as the current page to avoid mixed content errors
  // If page is HTTPS, use HTTPS; if HTTP, use HTTP
  const hostname = window.location.hostname
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${hostname}:8000`
}

/**
 * Check if API URL is available (not disabled)
 */
export function isApiUrlAvailable() {
  return getApiUrl() !== null
}

