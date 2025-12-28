# System Cleanup Commands

## Zombie Process Cleanup

The following commands will kill the duplicate `node --watch` processes identified in the health check:

### Kill Zombie Processes

```bash
# Kill process 52522 (duplicate node --watch)
kill 52522

# Kill process 51990 (duplicate node --watch)
kill 51990

# Verify processes are terminated
ps aux | grep "node --watch" | grep -v grep
```

### Alternative: Kill All node --watch Processes

If you want to kill all `node --watch` processes at once:

```bash
# Find and kill all node --watch processes
pkill -f "node --watch"

# Or more specifically:
ps aux | grep "node --watch" | grep -v grep | awk '{print $2}' | xargs kill
```

### Verify Cleanup

After running the kill commands, verify the cleanup:

```bash
# Check for remaining node --watch processes
ps aux | grep "node --watch" | grep -v grep

# Should return no results if cleanup was successful
```

## NPM Cache Cleanup

### Clear NPM Cache

```bash
# Clear the npm cache
npm cache clean --force

# Verify cache size before and after
npm cache verify
```

### Alternative: Clear Specific Cache Locations

```bash
# Clear npm cache directory (macOS/Linux)
rm -rf ~/.npm/_cacache

# Or on macOS, you can also clear:
rm -rf ~/Library/Caches/npm
```

### Check Cache Size

```bash
# Check npm cache size
du -sh ~/.npm
# or
du -sh ~/Library/Caches/npm 2>/dev/null || echo "Cache directory not found"
```

## Complete Cleanup Script

Here's a complete script you can run to do all cleanup at once:

```bash
#!/bin/bash
# Complete cleanup script for Multiplayer Arcade

echo "=== Killing Zombie Processes ==="
pkill -f "node --watch" 2>/dev/null
sleep 1
echo "Remaining node --watch processes:"
ps aux | grep "node --watch" | grep -v grep || echo "None found"

echo ""
echo "=== Clearing NPM Cache ==="
npm cache clean --force
npm cache verify

echo ""
echo "=== Cleanup Complete ==="
```

### Make Script Executable and Run

```bash
# Save the script above to cleanup.sh, then:
chmod +x cleanup.sh
./cleanup.sh
```

## Disk Space Cleanup (Additional)

If you need more disk space, consider these additional cleanup options:

```bash
# Remove node_modules and reinstall (if needed)
# WARNING: Only do this if you're sure you can reinstall dependencies
# cd "/Users/joshuarizzo/Apps/Multiplayer Arcade"
# rm -rf node_modules server/node_modules
# npm install
# cd server && npm install

# Clear system logs (macOS)
sudo rm -rf /private/var/log/*.log
sudo rm -rf /private/var/log/asl/*.asl

# Clear user cache (macOS)
rm -rf ~/Library/Caches/*

# Check disk usage
df -h
```

## Notes

- The `kill` command sends a TERM signal, which allows processes to clean up gracefully
- If processes don't terminate, use `kill -9 <PID>` for force kill (use with caution)
- NPM cache cleanup is safe and won't affect installed packages
- Always verify processes are terminated before proceeding
