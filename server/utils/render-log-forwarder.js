// Utility to forward Render server logs to Vercel API endpoint
// This allows centralized logging in Vercel dashboard

const VERCEL_LOG_ENDPOINT = process.env.VERCEL_LOG_ENDPOINT || null;

/**
 * Forward a log message to Vercel's logging endpoint
 * @param {string} level - Log level (info, error, warn, debug)
 * @param {string} message - Log message
 * @param {object} metadata - Additional metadata to include
 */
export async function forwardLogToVercel(level, message, metadata = {}) {
  // Only forward if endpoint is configured
  if (!VERCEL_LOG_ENDPOINT) {
    return;
  }

  try {
    const logPayload = {
      level,
      message,
      service: 'render-backend',
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production'
      }
    };

    // Send to Vercel API endpoint (fire and forget - don't block)
    fetch(VERCEL_LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logPayload)
    }).catch(error => {
      // Silently fail - don't break the app if logging fails
      console.error('[LOG-FORWARDER] Failed to forward log:', error.message);
    });

  } catch (error) {
    // Silently fail - don't break the app if logging fails
    console.error('[LOG-FORWARDER] Error in log forwarder:', error.message);
  }
}

/**
 * Wrapper for console.log that also forwards to Vercel
 */
export function logWithForward(level, message, ...args) {
  // Log locally first
  console[level]?.(message, ...args) || console.log(message, ...args);
  
  // Forward to Vercel
  forwardLogToVercel(level, message, { args });
}

/**
 * Wrapper for console.error that also forwards to Vercel
 */
export function errorWithForward(message, error) {
  console.error(message, error);
  forwardLogToVercel('error', message, { 
    error: error?.message,
    stack: error?.stack 
  });
}

