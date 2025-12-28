// Sound manager using Web Audio API to generate simple sound effects

class SoundManager {
  constructor() {
    this.audioContext = null
    this.enabled = true
    this.audioContextResumed = false
    this.init()
    this.setupUserInteractionHandler()
  }

  init() {
    try {
      // Create audio context (will be resumed on user interaction)
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
    } catch (e) {
      console.warn('Web Audio API not supported')
      this.enabled = false
    }
  }

  // Setup global user interaction handler to resume audio context
  setupUserInteractionHandler() {
    if (!this.enabled) return

    const resumeAudioContext = async () => {
      if (!this.audioContextResumed && this.audioContext) {
        try {
          await this.ensureAudioContext()
          this.audioContextResumed = true
          // Remove listeners after first successful resume
          window.removeEventListener('click', resumeAudioContext, { capture: true })
          window.removeEventListener('touchstart', resumeAudioContext, { capture: true })
          window.removeEventListener('keydown', resumeAudioContext, { capture: true })
        } catch (e) {
          console.warn('Could not resume audio context on user interaction:', e)
        }
      }
    }

    // Add listeners for user interactions (capture phase to catch early)
    window.addEventListener('click', resumeAudioContext, { capture: true, once: false })
    window.addEventListener('touchstart', resumeAudioContext, { capture: true, once: false })
    window.addEventListener('keydown', resumeAudioContext, { capture: true, once: false })
  }

  // Ensure audio context is running (required for autoplay policies)
  async ensureAudioContext() {
    if (!this.enabled || !this.audioContext) return false
    
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume()
        this.audioContextResumed = true
      } catch (e) {
        console.warn('Could not resume audio context')
        return false
      }
    }
    return this.audioContext.state === 'running'
  }

  // Generate a simple tone
  async playTone(frequency, duration, type = 'sine', volume = 0.3) {
    if (!this.enabled || !this.audioContext) return

    // Ensure audio context is running before playing
    const ready = await this.ensureAudioContext()
    if (!ready) {
      // If audio context couldn't be resumed, try one more time
      // This handles cases where user interaction just happened
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume()
        } catch (e) {
          // Silently fail - sounds just won't play if audio is blocked
        }
      }
      if (this.audioContext.state !== 'running') return
    }

    try {
      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)

      oscillator.frequency.value = frequency
      oscillator.type = type

      // Envelope for smoother sound
      const now = this.audioContext.currentTime
      gainNode.gain.setValueAtTime(0, now)
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration)

      oscillator.start(now)
      oscillator.stop(now + duration)
    } catch (e) {
      // Silently fail if audio can't be played (e.g., audio context closed)
      console.warn('Could not play tone:', e)
    }
  }

  // Jump/flap sound - quick upward tone
  playJump() {
    this.playTone(400, 0.1, 'sine', 0.12)
  }

  // Score point sound - pleasant chime
  playScore() {
    this.playTone(523.25, 0.15, 'sine', 0.15) // C5
    setTimeout(() => {
      this.playTone(659.25, 0.15, 'sine', 0.15) // E5
    }, 50)
  }

  // Game over sound - descending tone
  playGameOver() {
    this.playTone(200, 0.2, 'sine', 0.18)
    setTimeout(() => {
      this.playTone(150, 0.3, 'sine', 0.18)
    }, 100)
  }

  // Collision sound - softer noise
  playCollision() {
    this.playTone(100, 0.2, 'sine', 0.2)
  }

  // Pinball-specific sounds
  playBumperHit(frequency = 300) {
    // Varied bumper sound based on frequency - softer
    this.playTone(frequency, 0.1, 'sine', 0.15)
    setTimeout(() => {
      this.playTone(frequency * 1.5, 0.08, 'sine', 0.12)
    }, 50)
  }

  playFlipperHit() {
    // Softer mechanical click
    this.playTone(200, 0.06, 'sine', 0.12)
    setTimeout(() => {
      this.playTone(250, 0.05, 'sine', 0.1)
    }, 30)
  }

  playWallBounce(intensity = 1) {
    // Vary based on impact intensity - softer
    const freq = 150 + (intensity * 50)
    const vol = 0.1 + (intensity * 0.05)
    this.playTone(freq, 0.12, 'sine', Math.min(vol, 0.2))
  }

  playBallDrain() {
    // Descending tone for ball loss - softer
    this.playTone(200, 0.18, 'sine', 0.18)
    setTimeout(() => {
      this.playTone(150, 0.22, 'sine', 0.18)
    }, 100)
    setTimeout(() => {
      this.playTone(100, 0.28, 'sine', 0.18)
    }, 200)
  }

  playLaunch() {
    // Softer upward sweep
    this.playTone(300, 0.12, 'sine', 0.15)
    setTimeout(() => {
      this.playTone(400, 0.1, 'sine', 0.12)
    }, 60)
  }

  // UI interaction sounds
  playClick() {
    // Quick, pleasant click sound
    this.playTone(600, 0.08, 'sine', 0.1)
  }

  playSelect() {
    // Slightly longer, more satisfying selection sound
    this.playTone(500, 0.1, 'sine', 0.12)
    setTimeout(() => {
      this.playTone(600, 0.08, 'sine', 0.1)
    }, 30)
  }

  playNavigate() {
    // Navigation/back sound - subtle
    this.playTone(400, 0.1, 'sine', 0.1)
  }

  playSuccess() {
    // Pleasant success chime
    this.playTone(523.25, 0.15, 'sine', 0.15) // C5
    setTimeout(() => {
      this.playTone(659.25, 0.15, 'sine', 0.15) // E5
    }, 80)
    setTimeout(() => {
      this.playTone(783.99, 0.15, 'sine', 0.15) // G5
    }, 160)
  }

  playError() {
    // Lower, warning tone
    this.playTone(200, 0.2, 'sine', 0.18)
    setTimeout(() => {
      this.playTone(150, 0.25, 'sine', 0.18)
    }, 100)
  }

  playHover() {
    // Very subtle hover sound (optional, can be disabled if too much)
    this.playTone(700, 0.05, 'sine', 0.05)
  }

  // Memory game specific sounds
  playCardFlip() {
    // Pleasant card flip sound - quick upward tone
    this.playTone(350, 0.12, 'sine', 0.12)
    setTimeout(() => {
      this.playTone(450, 0.1, 'sine', 0.1)
    }, 40)
  }

  playCardMatch() {
    // Celebratory match sound - ascending chord
    this.playTone(523.25, 0.15, 'sine', 0.18) // C5
    setTimeout(() => {
      this.playTone(659.25, 0.15, 'sine', 0.18) // E5
    }, 60)
    setTimeout(() => {
      this.playTone(783.99, 0.2, 'sine', 0.18) // G5
    }, 120)
  }

  playCardMismatch() {
    // Disappointing mismatch sound - descending tone
    this.playTone(300, 0.15, 'sine', 0.15)
    setTimeout(() => {
      this.playTone(250, 0.2, 'sine', 0.15)
    }, 80)
    setTimeout(() => {
      this.playTone(200, 0.15, 'sine', 0.12)
    }, 160)
  }

  playCardShuffle() {
    // Subtle shuffle/reveal sound when game starts
    this.playTone(400, 0.1, 'sine', 0.1)
    setTimeout(() => {
      this.playTone(500, 0.08, 'sine', 0.08)
    }, 50)
    setTimeout(() => {
      this.playTone(600, 0.06, 'sine', 0.06)
    }, 100)
  }
}

// Create singleton instance
const soundManager = new SoundManager()

export default soundManager

