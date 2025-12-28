// server/api/debug-logs.js
import express from 'express';
import cors from 'cors';

const router = express.Router();
router.use(cors());
router.use(express.json({ limit: '10mb' })); // Increase limit for client logs

// In-memory storage for client logs (last 1000 logs)
const clientLogs = [];
const MAX_LOGS = 1000;

// Server-side event logs
const serverEventLogs = [];
const MAX_SERVER_LOGS = 500;

// Function to add server event log (exported for use in index.js)
const addServerEventLog = (message, level = 'info', data = null) => {
  const logEntry = {
    message,
    level,
    timestamp: new Date().toISOString(),
    source: 'Server',
    data: data ? JSON.stringify(data) : null,
    serverTimestamp: new Date().toISOString()
  };
  serverEventLogs.push(logEntry);
  if (serverEventLogs.length > MAX_SERVER_LOGS) {
    serverEventLogs.shift();
  }
};

// POST: Receive logs from client
router.post('/client-logs', (req, res) => {
  const { logs, sessionId } = req.body;
  
  if (!Array.isArray(logs)) {
    return res.status(400).json({ error: 'logs must be an array' });
  }
  
  // Add session ID and timestamp to each log
  const timestampedLogs = logs.map(log => ({
    ...log,
    sessionId: sessionId || 'unknown',
    serverTimestamp: new Date().toISOString()
  }));
  
  clientLogs.push(...timestampedLogs);
  
  // Keep only last MAX_LOGS
  if (clientLogs.length > MAX_LOGS) {
    clientLogs.splice(0, clientLogs.length - MAX_LOGS);
  }
  
  res.json({ success: true, totalLogs: clientLogs.length });
});

// GET: Retrieve logs (optionally filtered)
router.get('/client-logs', (req, res) => {
  const { sessionId, level, limit = 100, since } = req.query;
  
  let filteredLogs = [...clientLogs];
  
  // Filter by sessionId
  if (sessionId) {
    filteredLogs = filteredLogs.filter(log => log.sessionId === sessionId);
  }
  
  // Filter by level
  if (level) {
    filteredLogs = filteredLogs.filter(log => log.level === level);
  }
  
  // Filter by timestamp
  if (since) {
    const sinceDate = new Date(since);
    filteredLogs = filteredLogs.filter(log => {
      const logTime = new Date(log.serverTimestamp || log.timestamp);
      return logTime >= sinceDate;
    });
  }
  
  // Limit results
  const limitNum = parseInt(limit);
  const recentLogs = filteredLogs.slice(-limitNum);
  
  res.json({
    total: filteredLogs.length,
    returned: recentLogs.length,
    logs: recentLogs
  });
});

// DELETE: Clear logs
router.delete('/client-logs', (req, res) => {
  const { sessionId } = req.query;
  
  if (sessionId) {
    // Clear logs for specific session
    const before = clientLogs.length;
    const filtered = clientLogs.filter(log => log.sessionId !== sessionId);
    clientLogs.length = 0;
    clientLogs.push(...filtered);
    res.json({ success: true, cleared: before - clientLogs.length, remaining: clientLogs.length });
  } else {
    // Clear all logs
    const cleared = clientLogs.length;
    clientLogs.length = 0;
    res.json({ success: true, cleared, remaining: 0 });
  }
});

// GET: Retrieve server event logs
router.get('/server-events', (req, res) => {
  const { level, limit = 100, since } = req.query;
  
  let filteredLogs = [...serverEventLogs];
  
  // Filter by level
  if (level) {
    filteredLogs = filteredLogs.filter(log => log.level === level);
  }
  
  // Filter by timestamp
  if (since) {
    const sinceDate = new Date(since);
    filteredLogs = filteredLogs.filter(log => {
      const logTime = new Date(log.serverTimestamp || log.timestamp);
      return logTime >= sinceDate;
    });
  }
  
  // Limit results
  const limitNum = parseInt(limit);
  const recentLogs = filteredLogs.slice(-limitNum);
  
  res.json({
    total: filteredLogs.length,
    returned: recentLogs.length,
    logs: recentLogs
  });
});

export default router;
export { addServerEventLog };

