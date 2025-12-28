// Fallback colors in case API is unavailable
const FALLBACK_COLORS = [
  { color: '#FF6B6B', emoji: '🦁' },
  { color: '#4ECDC4', emoji: '🐘' },
  { color: '#FFE66D', emoji: '🐼' },
  { color: '#95E1D3', emoji: '🦊' },
  { color: '#FF9F43', emoji: '🐯' },
  { color: '#A29BFE', emoji: '🐻' },
  { color: '#00D2D3', emoji: '🐬' },
  { color: '#FF6348', emoji: '🦄' },
  { color: '#FDCB6E', emoji: '🐨' },
  { color: '#6C5CE7', emoji: '🐸' },
  { color: '#00B894', emoji: '🐢' },
  { color: '#E17055', emoji: '🐺' },
  { color: '#74B9FF', emoji: '🐧' },
  { color: '#FDCB6E', emoji: '🦉' },
  { color: '#A29BFE', emoji: '🦅' },
  { color: '#00D2D3', emoji: '🦆' },
  { color: '#FF6348', emoji: '🐿️' },
  { color: '#6C5CE7', emoji: '🐰' },
  { color: '#00B894', emoji: '🐹' },
  { color: '#E17055', emoji: '🐭' },
  { color: '#74B9FF', emoji: '🐶' },
  { color: '#FDCB6E', emoji: '🐱' },
  { color: '#A29BFE', emoji: '🐴' },
  { color: '#00D2D3', emoji: '🦓' },
  { color: '#FF6348', emoji: '🦒' },
  { color: '#6C5CE7', emoji: '🐪' },
  { color: '#00B894', emoji: '🦘' },
  { color: '#E17055', emoji: '🐷' },
  { color: '#74B9FF', emoji: '🐮' },
  { color: '#FDCB6E', emoji: '🐔' },
  { color: '#A29BFE', emoji: '🦃' },
  { color: '#00D2D3', emoji: '🐝' },
  { color: '#FF6348', emoji: '🦋' },
  { color: '#6C5CE7', emoji: '🐛' },
  { color: '#00B894', emoji: '🦗' },
  { color: '#E17055', emoji: '🦂' },
  { color: '#74B9FF', emoji: '🦀' },
  { color: '#FDCB6E', emoji: '🦞' },
  { color: '#A29BFE', emoji: '🦐' },
  { color: '#00D2D3', emoji: '🐙' },
  { color: '#FF6348', emoji: '🦑' },
  { color: '#6C5CE7', emoji: '🐟' },
  { color: '#00B894', emoji: '🐠' },
  { color: '#E17055', emoji: '🦈' },
  { color: '#74B9FF', emoji: '🐳' },
  { color: '#FDCB6E', emoji: '🐋' },
  { color: '#A29BFE', emoji: '🦭' },
]

// Cache for player colors from API
let PLAYER_COLORS_CACHE = null
let colorsLoadPromise = null

// Use current hostname to support local network access (same as socket connections)
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // Use current hostname and protocol (works for both localhost and IP access)
  // Always use the same protocol as the current page to avoid mixed content errors
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:8000`
}

// Fetch player colors from API
async function fetchPlayerColors() {
  if (colorsLoadPromise) {
    return colorsLoadPromise
  }
  
  colorsLoadPromise = fetch(`${getApiUrl()}/api/player-colors`)
    .then(res => {
      if (!res.ok) throw new Error('Failed to fetch colors')
      return res.json()
    })
    .then(colors => {
      // Transform database format to simple {color, emoji} format
      PLAYER_COLORS_CACHE = colors.map(c => ({
        color: c.color,
        emoji: c.emoji
      }))
      return PLAYER_COLORS_CACHE
    })
    .catch(error => {
      console.warn('Failed to fetch player colors from API, using fallback:', error)
      PLAYER_COLORS_CACHE = FALLBACK_COLORS
      return PLAYER_COLORS_CACHE
    })
    .finally(() => {
      colorsLoadPromise = null
    })
  
  return colorsLoadPromise
}

// Get player colors (from cache or API)
export async function getPlayerColors() {
  if (PLAYER_COLORS_CACHE) {
    return PLAYER_COLORS_CACHE
  }
  return await fetchPlayerColors()
}

// Get player color and emoji based on their index
// If player data includes emoji/color (from server), use that instead
export function getPlayerStyle(playerId, players) {
  const player = players.find(p => p.id === playerId)
  if (!player) {
    return { color: '#FFFFFF', emoji: '⚪' }
  }
  
  // If player already has emoji/color assigned (from server), use that
  if (player.emoji && player.color) {
    return { color: player.color, emoji: player.emoji }
  }
  
  // Fallback to index-based assignment (for backwards compatibility)
  const index = players.findIndex(p => p.id === playerId)
  const colors = PLAYER_COLORS_CACHE || FALLBACK_COLORS
  const style = colors[index % colors.length]
  return style || { color: '#FFFFFF', emoji: '⚪' }
}

// Get animal/color for a profile based on profile index
export function getProfileAnimal(profileIndex) {
  const colors = PLAYER_COLORS_CACHE || FALLBACK_COLORS
  return colors[profileIndex % colors.length] || { color: '#FFFFFF', emoji: '⚪' }
}

// Initialize colors on module load
fetchPlayerColors().catch(() => {
  // Silently fail, will use fallback
})

