/**
 * Test script to search for a specific profile in NoCodeBackend
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

function buildUrl(endpoint) {
  return `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
}

async function testSearchProfile() {
  // First, create a test profile
  console.log('Creating test profile...')
  const createUrl = buildUrl('/create/userprofiles')
  const now = new Date()
  const dateString = now.toISOString().slice(0, 19).replace('T', ' ')
  const testName = `TestProfile_${Date.now()}`
  
  try {
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        name: testName,
        color: null,
        emoji: null,
        createdAt: dateString,
        lastSeen: dateString
      })
    })
    
    const createData = await createResponse.json()
    console.log('Created profile:', createData)
    const profileId = createData.id
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Now try to read all profiles
    console.log('\nReading all profiles...')
    const readUrl = buildUrl('/read/userprofiles')
    const readResponse = await fetch(readUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    
    const readData = await readResponse.json()
    console.log('Read response type:', typeof readData, Array.isArray(readData) ? 'array' : 'object')
    console.log('Read response keys:', readData && typeof readData === 'object' ? Object.keys(readData) : 'N/A')
    
    let profiles = []
    if (Array.isArray(readData)) {
      profiles = readData
    } else if (readData.data && Array.isArray(readData.data)) {
      profiles = readData.data
    } else if (readData.profiles && Array.isArray(readData.profiles)) {
      profiles = readData.profiles
    } else if (readData.status === 'success' && readData.data && Array.isArray(readData.data)) {
      profiles = readData.data
    }
    
    console.log(`\nFound ${profiles.length} profiles`)
    const foundProfile = profiles.find(p => p.id === profileId || p.name === testName)
    
    if (foundProfile) {
      console.log(`✅ Profile found! ID: ${foundProfile.id}, Name: "${foundProfile.name}"`)
    } else {
      console.log(`❌ Profile NOT found! Looking for ID: ${profileId}, Name: "${testName}"`)
      console.log('Available profile IDs:', profiles.map(p => p.id).join(', '))
      console.log('Available profile names:', profiles.map(p => p.name).join(', '))
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

testSearchProfile()

