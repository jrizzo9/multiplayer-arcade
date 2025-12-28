import { useState, useEffect } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuClickButton } from '../../utils/cpuPlayer'

function ClickButtonMicrogame({ onComplete, timeLimit }) {
  const [clicks, setClicks] = useState(0)
  const [targetClicks, setTargetClicks] = useState(3)
  const [buttonPosition, setButtonPosition] = useState({ x: 50, y: 50 })
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
    // Randomize button position
    const x = Math.random() * 60 + 20 // 20-80%
    const y = Math.random() * 60 + 20 // 20-80%
    setButtonPosition({ x, y })
    setTargetClicks(Math.floor(Math.random() * 3) + 3) // 3-5 clicks
    setClicks(0)
  }, [])

  // CPU auto-play
  useEffect(() => {
    if (isCPU && clicks < targetClicks) {
      cpuClickButton(setClicks, clicks, targetClicks, setButtonPosition, onComplete)
    }
  }, [isCPU, clicks, targetClicks, onComplete])

  const handleClick = () => {
    const newClicks = clicks + 1
    setClicks(newClicks)
    
    if (newClicks >= targetClicks) {
      onComplete(true)
    } else {
      // Move button to new random position
      const x = Math.random() * 60 + 20
      const y = Math.random() * 60 + 20
      setButtonPosition({ x, y })
    }
  }

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Click the button {targetClicks} times!
      </div>
      <div className="text-white text-lg mb-8">
        Clicks: {clicks} / {targetClicks}
      </div>
      <button
        onClick={handleClick}
        onTouchStart={(e) => {
          e.preventDefault()
          handleClick()
        }}
        className="absolute px-6 md:px-8 py-3 md:py-4 text-sm md:text-base text-white border-2 border-white rounded-lg hover:bg-white hover:text-black active:bg-white active:text-black transition-all duration-200 cursor-pointer"
        style={{
          left: `${buttonPosition.x}%`,
          top: `${buttonPosition.y}%`,
          transform: 'translate(-50%, -50%)',
          touchAction: 'manipulation'
        }}
      >
        CLICK ME!
      </button>
    </div>
  )
}

export default ClickButtonMicrogame

