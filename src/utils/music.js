// Background music manager

class MusicManager {
  constructor() {
    this.audio = null
    this.isEnabled = false
    this.isPlaying = false
    this.volume = 0.3 // 30% volume for background music
    this.musicPath = '/Video Game Loop 1.wav'
  }

  async init() {
    if (this.audio) return

    try {
      this.audio = new Audio(this.musicPath)
      this.audio.loop = true
      this.audio.volume = this.volume
      
      // Handle errors
      this.audio.addEventListener('error', (e) => {
        console.error('Music playback error:', e)
      })

      // Handle when music ends (shouldn't happen with loop, but just in case)
      this.audio.addEventListener('ended', () => {
        if (this.isEnabled && this.isPlaying) {
          this.audio.play().catch(err => {
            console.error('Error restarting music:', err)
          })
        }
      })

      // Handle play/pause state changes
      this.audio.addEventListener('play', () => {
        this.isPlaying = true
      })

      this.audio.addEventListener('pause', () => {
        this.isPlaying = false
      })
    } catch (error) {
      console.error('Error initializing music:', error)
    }
  }

  async enable() {
    await this.init()
    
    if (!this.audio) {
      console.error('Music audio not initialized')
      return
    }

    try {
      this.isEnabled = true
      await this.audio.play()
      this.isPlaying = true
    } catch (error) {
      console.error('Error enabling music:', error)
      // If autoplay is blocked, user will need to interact first
      this.isEnabled = true
      this.isPlaying = false
    }
  }

  async play() {
    if (!this.isEnabled) {
      await this.enable()
      return
    }

    if (!this.audio || this.isPlaying) return

    try {
      await this.audio.play()
      this.isPlaying = true
    } catch (error) {
      console.error('Error playing music:', error)
    }
  }

  pause() {
    if (!this.audio || !this.isPlaying) return

    try {
      this.audio.pause()
      this.isPlaying = false
    } catch (error) {
      console.error('Error pausing music:', error)
    }
  }

  stop() {
    if (!this.audio) return

    try {
      this.audio.pause()
      this.audio.currentTime = 0
      this.isPlaying = false
    } catch (error) {
      console.error('Error stopping music:', error)
    }
  }

  setVolume(volume) {
    // Volume should be between 0 and 1
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.audio) {
      this.audio.volume = this.volume
    }
  }

  getVolume() {
    return this.volume
  }

  getIsPlaying() {
    return this.isPlaying
  }

  getIsEnabled() {
    return this.isEnabled
  }
}

// Create singleton instance
const musicManager = new MusicManager()

export default musicManager

