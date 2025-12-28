#!/bin/bash
# Script to retrieve and display client logs from the server

SERVER_URL="http://localhost:8000"
LIMIT=${1:-200}
FILTER=${2:-""}

echo "=== Fetching Client Logs (last $LIMIT) ==="
echo ""

# Get client logs
if [ -z "$FILTER" ]; then
  curl -s "${SERVER_URL}/api/debug/client-logs?limit=${LIMIT}" | python3 -m json.tool
else
  echo "Filtering for: $FILTER"
  curl -s "${SERVER_URL}/api/debug/client-logs?limit=${LIMIT}" | python3 -c "
import json
import sys

data = json.load(sys.stdin)
logs = data.get('logs', [])

# Filter logs
filtered = [log for log in logs if '$FILTER'.lower() in json.dumps(log).lower()]

print(json.dumps({
    'total': len(filtered),
    'logs': filtered_logs
}, indent=2))
"
fi

