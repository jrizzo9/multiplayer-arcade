#!/bin/bash
# Script to check client logs for player leave events

SERVER_URL="http://localhost:8000"

echo "=== Checking for Player Leave Events ==="
echo ""

# Get recent logs and filter for player-left and room-snapshot
curl -s "${SERVER_URL}/api/debug/client-logs?limit=500" | python3 -c "
import json
import sys
from datetime import datetime

data = json.load(sys.stdin)
logs = data.get('logs', [])

# Filter for relevant logs
keywords = ['player-left', 'room-snapshot', 'DEBUG', 'ROOM-PROVIDER', 'ROOM-MANAGER', 'USE-ROOM']
relevant_logs = []

for log in logs:
    message = log.get('message', '').lower()
    raw = log.get('raw', [])
    raw_str = ' '.join([str(r) for r in raw]).lower()
    
    # Check if log contains any keywords
    if any(keyword.lower() in message or keyword.lower() in raw_str for keyword in keywords):
        relevant_logs.append(log)

print(f'Found {len(relevant_logs)} relevant logs\n')
print('=' * 80)

# Group by session
sessions = {}
for log in relevant_logs:
    session = log.get('sessionId', 'unknown')
    if session not in sessions:
        sessions[session] = []
    sessions[session].append(log)

# Display logs grouped by session, most recent first
for session_id, session_logs in sorted(sessions.items(), key=lambda x: x[1][-1].get('serverTimestamp', ''), reverse=True):
    print(f'\n--- Session: {session_id[:30]}... ({len(session_logs)} logs) ---')
    
    # Sort by timestamp
    session_logs.sort(key=lambda x: x.get('serverTimestamp', x.get('timestamp', '')))
    
    for log in session_logs[-30:]:  # Last 30 per session
        timestamp = log.get('timestamp', log.get('serverTimestamp', 'N/A'))
        level = log.get('level', 'info')
        message = log.get('message', '')
        
        # Truncate very long messages
        if len(message) > 300:
            message = message[:300] + '... [truncated]'
        
        print(f'  [{timestamp}] [{level.upper()}] {message}')
        
        # Show raw data if it contains player info
        raw = log.get('raw', [])
        if raw and any('player' in str(r).lower() or 'room' in str(r).lower() for r in raw):
            raw_str = json.dumps(raw, indent=4)
            if len(raw_str) < 500:
                print(f'    Raw: {raw_str[:500]}')
"

echo ""
echo "=== To see all logs, run: curl -s http://localhost:8000/api/debug/client-logs?limit=1000 | python3 -m json.tool ==="

