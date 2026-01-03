/**
 * Test script to count all profiles and check for pagination
 */

const NOCODE_BACKEND_URL = 'https://api.nocodebackend.com'
const API_KEY = 'a0f3809faaeb351310c3f6e9505ca7e28f5770a1f8e90abf6cb8d9d3960e468e'
const INSTANCE = '55050_multiplayer_arcade'

function buildUrl(endpoint, params = {}) {
  const baseUrl = `${NOCODE_BACKEND_URL}${endpoint}?Instance=${INSTANCE}`
  const queryParams = new URLSearchParams(params).toString()
  return queryParams ? `${baseUrl}&${queryParams}` : baseUrl
}

async function countAllProfiles() {
  console.log('Checking total number of profiles...\n')
  
  // Try read endpoint
  const readUrl = buildUrl('/read/userprofiles')
  console.log('1. Testing read endpoint...')
  try {
    const response = await fetch(readUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    const data = await response.json()
    let profiles = []
    if (Array.isArray(data)) {
      profiles = data
    } else if (data.data && Array.isArray(data.data)) {
      profiles = data.data
    } else if (data.status === 'success' && data.data && Array.isArray(data.data)) {
      profiles = data.data
    }
    console.log(`   Read endpoint returned: ${profiles.length} profiles`)
    if (profiles.length > 0) {
      console.log(`   Profile IDs: ${profiles.map(p => p.id).join(', ')}`)
      console.log(`   Highest ID: ${Math.max(...profiles.map(p => p.id))}`)
    }
    if (data.metadata) {
      console.log(`   Metadata:`, JSON.stringify(data.metadata, null, 2))
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`)
  }
  
  // Try with limit parameter
  console.log('\n2. Testing read endpoint with limit=100...')
  try {
    const readUrlLimit = buildUrl('/read/userprofiles', { limit: 100 })
    const response = await fetch(readUrlLimit, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    const data = await response.json()
    let profiles = []
    if (Array.isArray(data)) {
      profiles = data
    } else if (data.data && Array.isArray(data.data)) {
      profiles = data.data
    } else if (data.status === 'success' && data.data && Array.isArray(data.data)) {
      profiles = data.data
    }
    console.log(`   Read endpoint with limit=100 returned: ${profiles.length} profiles`)
    if (profiles.length > 0) {
      console.log(`   Profile IDs: ${profiles.map(p => p.id).join(', ')}`)
      console.log(`   Highest ID: ${Math.max(...profiles.map(p => p.id))}`)
    }
  } catch (error) {
    console.log(`   Error: ${error.message}`)
  }
  
  // Try search with a query that should match all
  console.log('\n3. Testing search endpoint with name filter...')
  try {
    const searchUrl = buildUrl('/search/userprofiles')
    // Try searching for profiles with names starting with any letter
    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        name: { $ne: null } // Should match all profiles with a name
      })
    })
    const data = await response.json()
    console.log(`   Search response:`, JSON.stringify(data, null, 2).substring(0, 500))
  } catch (error) {
    console.log(`   Error: ${error.message}`)
  }
  
  // Try reading a specific high ID to see if it exists
  console.log('\n4. Testing if profile ID 20 exists...')
  try {
    const readUrlId = buildUrl('/read/userprofiles/20')
    const response = await fetch(readUrlId, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })
    const data = await response.json()
    console.log(`   Profile ID 20:`, JSON.stringify(data, null, 2))
  } catch (error) {
    console.log(`   Error: ${error.message}`)
  }
}

countAllProfiles()

