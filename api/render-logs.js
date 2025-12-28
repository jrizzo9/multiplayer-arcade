// Vercel Serverless Function to receive and forward Render logs
// This allows Render logs to appear in Vercel's logging system

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const logData = req.body;
    
    // Extract log information
    const timestamp = new Date().toISOString();
    const logLevel = logData.level || 'info';
    const message = logData.message || JSON.stringify(logData);
    const service = logData.service || 'render-backend';
    const metadata = logData.metadata || {};

    // Format log message for Vercel
    const logMessage = `[${timestamp}] [${service}] [${logLevel.toUpperCase()}] ${message}`;
    
    // Log to Vercel's function logs (visible in Vercel dashboard)
    console.log(logMessage, metadata);

    // Also log structured data for better parsing
    if (Object.keys(metadata).length > 0) {
      console.log('[RENDER-LOG-METADATA]', JSON.stringify(metadata));
    }

    // Return success
    return res.status(200).json({ 
      success: true, 
      received: timestamp,
      message: 'Log received and forwarded to Vercel logs'
    });

  } catch (error) {
    console.error('[RENDER-LOG-ERROR] Failed to process log:', error);
    return res.status(500).json({ 
      error: 'Failed to process log',
      details: error.message 
    });
  }
}

