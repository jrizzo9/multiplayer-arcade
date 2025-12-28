// Room state persistence utility - saves to localStorage for persistence across refreshes

const ROOM_STATE_KEY = 'multiplayer_arcade_room_state'

// Save room state to localStorage
export function saveRoomState(roomState) {
  try {
    if (roomState) {
      localStorage.setItem(ROOM_STATE_KEY, JSON.stringify(roomState))
    } else {
      localStorage.removeItem(ROOM_STATE_KEY)
    }
  } catch (error) {
    console.error('[saveRoomState] Error saving room state to localStorage:', error)
  }
}

// Load room state from localStorage
export function loadRoomState() {
  try {
    const stored = localStorage.getItem(ROOM_STATE_KEY)
    if (stored) {
      const roomState = JSON.parse(stored)
      return roomState
    }
  } catch (error) {
    console.error('[loadRoomState] Error loading room state from localStorage:', error)
  }
  return null
}

// Clear room state from localStorage
export function clearRoomState() {
  try {
    localStorage.removeItem(ROOM_STATE_KEY)
  } catch (error) {
    console.error('[clearRoomState] Error clearing room state from localStorage:', error)
  }
}

