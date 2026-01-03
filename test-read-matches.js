/**
 * Test reading matches to see the table structure
 */

const API_KEY = '4d00ba698fcab74d4269f9819557d85114bf634be820db33e133c9e7594f'
const BASE_URL = 'http://api.nocodebackend.com'
const INSTANCE = '55050_multiplayer_arcade'

async function testReadMatches() {
  console.log('🔍 Reading existing matches to see table structure\n')

  const url = `${BASE_URL}/read/Matches?Instance=${INSTANCE}`
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    })

    const responseText = await response.text()
    console.log(`Status: ${response.status}`)
    console.log(`Response: ${responseText}`)

    if (response.ok) {
      try {
        const result = JSON.parse(responseText)
        console.log('\n✅ Success! Table structure:')
        if (Array.isArray(result) && result.length > 0) {
          console.log('Sample record:', JSON.stringify(result[0], null, 2))
          console.log('\nField names:', Object.keys(result[0]))
        } else {
          console.log('No records found, but table exists')
        }
      } catch (e) {
        console.log('Response (not JSON):', responseText)
      }
    } else {
      console.log('❌ Failed to read')
    }
  } catch (error) {
    console.error('Error:', error.message)
  }
}

testReadMatches().catch(console.error)

