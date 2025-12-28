import { useState, useEffect } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuTapFast } from '../../utils/cpuPlayer'

function TapFastMicrogame({ onComplete, timeLimit }) {
  const [taps, setTaps] = useState(0)
  const [targetTaps, setTargetTaps] = useState(10)
  const [isCPU, setIsCPU] = useState(false)

  useEffect(() => {
    // Check if CPU profile
    const checkCPU = async () => {
      const profile = await getCurrentProfile()
      setIsCPU(isCPUProfile(profile))
    }
    checkCPU()
  }, [])

  useEffect(() => {
    setTargetTaps(Math.floor(Math.random() * 5) + 8) // 8-12 taps
    setTaps(0)
  }, [])

  // CPU auto-play - very fast for competitive play
  useEffect(() => {
    if (isCPU && taps < targetTaps) {
      const tapInterval = setInterval(() => {
        setTaps(prev => {
          const newTaps = prev + 1
          if (newTaps >= targetTaps) {
            clearInterval(tapInterval)
            onComplete(true)
          }
          return newTaps
        })
      }, 30 + Math.random() * 20) // Very fast (30-50ms per tap)
      
      return () => clearInterval(tapInterval)
    }
  }, [isCPU, taps, targetTaps, onComplete])

  const handleTap = () => {
    const newTaps = taps + 1
    setTaps(newTaps)
    
    if (newTaps >= targetTaps) {
      onComplete(true)
    }
  }

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Tap {targetTaps} times as fast as you can!
      </div>
      <div className="text-white text-4xl font-bold mb-8">
        {taps} / {targetTaps}
      </div>
      
      <button
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault()
          handleTap()
        }}
        className="px-8 md:px-12 py-6 md:py-8 text-xl md:text-2xl font-bold text-white border-4 border-white rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-100 cursor-pointer"
        style={{ touchAction: 'manipulation' }}
      >
        TAP!
      </button>
    </div>
  )
}

export default TapFastMicrogame

