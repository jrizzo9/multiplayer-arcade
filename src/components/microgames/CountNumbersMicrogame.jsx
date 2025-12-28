import { useState, useEffect } from 'react'
import { getCurrentProfile } from '../../utils/profiles'
import { isCPUProfile, cpuCountNumbers, getCPUDelay } from '../../utils/cpuPlayer'

function CountNumbersMicrogame({ onComplete, timeLimit }) {
  const [numbers, setNumbers] = useState([])
  const [targetCount, setTargetCount] = useState(0)
  const [selectedCount, setSelectedCount] = useState(0)
  const [clickedNumbers, setClickedNumbers] = useState(new Set())
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
    // Generate random numbers
    const count = Math.floor(Math.random() * 5) + 5 // 5-9 numbers
    const target = Math.floor(Math.random() * 3) + 3 // 3-5 target count
    const nums = []
    
    for (let i = 0; i < count; i++) {
      nums.push(Math.floor(Math.random() * 10))
    }
    
    setNumbers(nums)
    setTargetCount(target)
    setSelectedCount(0)
    setClickedNumbers(new Set())
  }, [])

  const handleNumberClick = (index) => {
    if (clickedNumbers.has(index)) return
    
    const newClicked = new Set(clickedNumbers)
    newClicked.add(index)
    setClickedNumbers(newClicked)
    
    const newCount = selectedCount + 1
    setSelectedCount(newCount)
    
    if (newCount === targetCount) {
      // Check if correct
      const clickedValues = Array.from(newClicked).map(i => numbers[i])
      const sum = clickedValues.reduce((a, b) => a + b, 0)
      const expectedSum = numbers.slice(0, targetCount).reduce((a, b) => a + b, 0)
      
      // For simplicity, just check if they clicked the right number of items
      // In a real version, you might want to check if they clicked numbers that sum to something
      onComplete(true)
    }
  }

  // CPU auto-play - fast clicking
  useEffect(() => {
    if (isCPU && numbers.length > 0 && targetCount > 0 && clickedNumbers.size < targetCount) {
      // Click the first targetCount numbers quickly
      numbers.forEach((num, index) => {
        if (index < targetCount && !clickedNumbers.has(index)) {
          setTimeout(() => {
            handleNumberClick(index)
          }, 50 + index * 30) // Fast sequential clicks
        }
      })
    }
  }, [isCPU, numbers, targetCount, clickedNumbers])

  return (
    <div className="w-full h-96 flex flex-col items-center justify-center relative border-2 border-white bg-black">
      <div className="text-white text-xl mb-4 text-center">
        Click exactly {targetCount} numbers!
      </div>
      <div className="text-white text-lg mb-8">
        Selected: {selectedCount} / {targetCount}
      </div>
      
      <div className="flex flex-wrap gap-2 md:gap-4 justify-center max-w-md">
        {numbers.map((num, index) => (
          <button
            key={index}
            onClick={() => handleNumberClick(index)}
            onTouchStart={(e) => {
              e.preventDefault()
              if (!clickedNumbers.has(index)) {
                handleNumberClick(index)
              }
            }}
            disabled={clickedNumbers.has(index)}
            className={`w-12 h-12 md:w-16 md:h-16 text-xl md:text-2xl font-bold border-2 rounded-lg transition-all duration-200 cursor-pointer ${
              clickedNumbers.has(index)
                ? 'bg-white text-black border-white'
                : 'bg-transparent text-white border-white hover:bg-white hover:text-black active:bg-white active:text-black'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  )
}

export default CountNumbersMicrogame

