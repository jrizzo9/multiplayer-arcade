/**
 * Test script to read all profiles from NoCodeBackend
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

function buildUrl(endpoint) {
  return `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
}

async function testReadProfiles() {
  const url = buildUrl('/read/userprofiles')
  
  console.log('Reading all profiles from NoCodeBackend...')
  console.log('URL:', url)
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    
    console.log('\nResponse Status:', response.status, response.statusText)
    const text = await response.text()
    console.log('Response Body (first 500 chars):', text.substring(0, 500))
    
    if (!response.ok) {
      console.error('\n❌ Failed to read profiles!')
      return
    }
    
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      console.error('Could not parse as JSON:', e)
      return
    }
    
    // Handle different response formats
    let profiles = []
    if (Array.isArray(data)) {
      profiles = data
    } else if (data.data && Array.isArray(data.data)) {
      profiles = data.data
    } else if (data.profiles && Array.isArray(data.profiles)) {
      profiles = data.profiles
    }
    
    console.log(`\n✅ Found ${profiles.length} profiles:`)
    profiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ID: ${p.id}, Name: "${p.name}"`)
    })
    
    // Show the most recent profile
    if (profiles.length > 0) {
      const recent = profiles[profiles.length - 1]
      console.log(`\nMost recent profile:`)
      console.log(JSON.stringify(recent, null, 2))
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

testReadProfiles()
