/**
 * Test script to search for all profiles in NoCodeBackend
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

function buildUrl(endpoint) {
  return `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
}

async function testSearchAllProfiles() {
  const url = buildUrl('/search/userprofiles')
  
  console.log('Searching for all profiles in NoCodeBackend...')
  console.log('URL:', url)
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({}) // Empty search to get all
    })
    
    console.log('\nResponse Status:', response.status, response.statusText)
    const text = await response.text()
    console.log('Response Body (first 1000 chars):', text.substring(0, 1000))
    
    if (!response.ok) {
      console.error('\n❌ Failed to search profiles!')
      return
    }
    
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      console.error('Could not parse as JSON:', e)
      return
    }
    
    console.log('\nResponse type:', typeof data, Array.isArray(data) ? 'array' : 'object')
    if (data && typeof data === 'object') {
      console.log('Response keys:', Object.keys(data))
    }
    
    // Handle different response formats
    let profiles = []
    if (Array.isArray(data)) {
      profiles = data
    } else if (data.data && Array.isArray(data.data)) {
      profiles = data.data
    } else if (data.profiles && Array.isArray(data.profiles)) {
      profiles = data.profiles
    } else if (data.status === 'success' && data.data && Array.isArray(data.data)) {
      profiles = data.data
    }
    
    console.log(`\n✅ Found ${profiles.length} profiles via search:`)
    profiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ID: ${p.id}, Name: "${p.name}"`)
    })
    
    // Compare with read endpoint
    console.log('\n--- Comparing with read endpoint ---')
    const readUrl = buildUrl('/read/userprofiles')
    const readResponse = await fetch(readUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    const readData = await readResponse.json()
    let readProfiles = []
    if (Array.isArray(readData)) {
      readProfiles = readData
    } else if (readData.data && Array.isArray(readData.data)) {
      readProfiles = readData.data
    } else if (readData.status === 'success' && readData.data && Array.isArray(readData.data)) {
      readProfiles = readData.data
    }
    console.log(`Read endpoint returned ${readProfiles.length} profiles`)
    console.log(`Search endpoint returned ${profiles.length} profiles`)
    
    if (profiles.length > readProfiles.length) {
      console.log(`\n✅ Search endpoint returns MORE profiles (${profiles.length} vs ${readProfiles.length})`)
    } else if (profiles.length === readProfiles.length) {
      console.log(`\n⚠️  Both endpoints return the same number of profiles`)
    } else {
      console.log(`\n❌ Search endpoint returns FEWER profiles (${profiles.length} vs ${readProfiles.length})`)
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

testSearchAllProfiles()

