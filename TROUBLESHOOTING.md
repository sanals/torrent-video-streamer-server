# Troubleshooting Guide - Backend Server

## Common Issues

### Port Already in Use

**Error**: `EADDRINUSE: address already in use :::4000`

**Solution**:
```powershell
# Windows - Find and kill process
.\stop-port-4000.ps1

# Or manually:
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

### Server Won't Start

**Check**:
1. Node.js version: `node --version` (must be v18+)
2. Dependencies installed: `npm install`
3. `.env` file exists and is configured
4. Port 4000 is available

### Frontend Can't Connect

**Check**:
1. Backend is running on port 4000
2. CORS settings in `.env`:
   - For Tailscale: `CORS_ORIGIN=*`
   - For localhost: `CORS_ORIGIN=http://localhost:3000`
3. Firewall allows port 4000
4. Frontend `.env.local` has correct `VITE_API_URL`

### Jackett Issues

**Problem**: "No results found" or connection errors
**Check**:
1. Jackett is running: Access `http://localhost:9117` in your browser.
2. API Key is correct: Check `JACKETT_API_KEY` in your `.env` file matches the dashboard.
3. Indexers are added: You must add indexers (TPB, 1337x, etc.) inside the Jackett dashboard.
4. Firewall: Ensure Jackett's port (9117) isn't blocked.

### FFmpeg / FFprobe Issues
**Problem**: Server crashes with `ERR_HTTP_HEADERS_SENT` or "Stream info failed"

**Solution**:
1.  **FFprobe Timeout**: Large files on slow networks might time out during probing. This is usually handled gracefully now, but checks your network.
2.  **Missing FFprobe**: Ensure `ffprobe` is installed and in your PATH alongside `ffmpeg`.
3.  **Corrupt File**: The torrent file header might be partial. Wait for more download progress.

**Problem**: Video stalls on seek or fails to play
**Solution**:
1. Verify installation: Run `ffmpeg -version` in terminal.
2. PATH configuration: Ensure the FFmpeg `bin` folder is in your System PATH.
3. Transcoding: Some advanced formats require FFmpeg for real-time transcoding.


### Memory Issues

**Problem**: Server runs out of memory

**Solutions**:
1. Use disk storage: `TORRENT_STORAGE_MODE=disk`
2. Limit concurrent torrents
3. Enable auto-delete: `AUTO_DELETE_ON_DISCONNECT=true`
4. Increase Node.js memory: `node --max-old-space-size=4096 src/server.js`

### WebSocket Connection Issues

**Problem**: Frontend can't connect via WebSocket

**Check**:
1. WebSocket server is running (check logs)
2. Firewall allows WebSocket connections
3. Frontend `VITE_WS_URL` is correct
4. CORS allows WebSocket origin

### Torrents Not Downloading

**Check**:
1. Internet connection
2. Torrent has seeders/peers
3. Check server logs for errors
4. Verify torrent is valid (try different torrent)

## Getting Help

1. Check server logs for error messages
2. Verify all environment variables are set correctly
3. Test with a known working torrent
4. Check the main repository's troubleshooting guide


