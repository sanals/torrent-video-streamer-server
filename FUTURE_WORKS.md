# Planned Improvements - TV Streamer

This document outlines the next set of prioritized tasks for the TV Streamer project.
Items are ordered by urgency.

## 0. Optimize Torrent Addition Responsiveness (PRIORITY)
**Goal**: Make the torrent addition process non-blocking and highly responsive without losing metadata visibility.

### ⚠️ Issues Faced During Attempted Fix:
- **API Hanging**: The `POST /api/torrents` endpoint currenty waits for WebTorrent to finish gathering metadata (file list, name, total size) before responding. This can take several minutes if peers are scarce, causing browser timeouts.
- **UI State Disconnect**: The "Add" button in search results resets its state before the torrent actually appears in the global `TorrentList`, leading to user confusion and duplicate addition attempts.
- **Duplicate Key Warnings**: Using `magnetURI` as the primary key in the backend `torrents` Map is problematic because multiple magnet links can point to the same `infoHash`. This causes React duplicate key warnings in the frontend list.
- **"NaN undefined" UI**: If a torrent is added non-blocking, fields like `length` and `downloadSpeed` are initially `undefined`, causing the `formatBytes` utility to output "NaN undefined" in the UI.
- **Metadata Sync**: There is currently no robust event-driven mechanism to notify the frontend (via WebSocket) the exact moment background metadata loading finishes. The UI needs an immediate "torrent:update" broadcast when the `client.add` callback fires.

### 💡 Recommendation for Future Fix:
1. Refactor `TorrentManager.js` to inherit from `EventEmitter`.
2. Consistently use `infoHash` as the map key in the backend.
3. Resolve the API call immediately with a serialized torrent object containing "Loading..." placeholders.
4. Emit a `metadata` event in the backend and broadcast it via WebSocket to force a frontend refresh once files are found.
5. Update `formatUtils.ts` to handle `undefined` or `NaN` gracefully.

## 1. Clear All Torrents
**Goal**: Allow users to clear all loaded torrents at once when multiple torrents are active.
- **Backend**: Implement `DELETE /api/torrents` to stop and remove all managed torrents.
- **Frontend**: Add a "Clear All" button in the `TorrentList` header with a confirmation dialog.

## 2. SeekBar UX Improvements
**Goal**: Prevent accidental clicks on volume or fullscreen buttons while seeking.
- **Problem**: Overlaying click areas or close proximity of buttons leads to unintended actions during seekbar interaction.
- **Solution**: Increase padding/spacing or adjust the hit-test areas for controls. Consider a "dead zone" or a dedicated seeking mode that disables other controls temporarily.

## 3. Subtitle Isolation & Cleanup
**Goal**: Ensure subtitles are specific to the video file being played.
- **Problem**: Adding a subtitle to one video currently causes it to appear when playing a subsequent different video.
- **Solution**: Track subtitle state per `infoHash` and `fileIndex`. Clear the subtitle list when a new video is loaded.

## 4. Fullscreen Control Management
**Goal**: Ensure UI controls (seekbar, buttons) consistently hide in fullscreen mode.
- **Problem**: Controls sometimes remain visible or stuck in fullscreen, requiring a toggle to fix.
- **Solution**: Debug the `Fade` logic and mouse inactivity timers in `VideoPlayer.tsx`. Ensure the activity listener correctly resets the timer in fullscreen.

## 5. Embedded Subtitle Support
**Goal**: Extract and display subtitles directly from the video file.
- **Solution**: Use FFmpeg to probe for internal subtitle tracks and extract them as WebVTT on-the-fly via a dedicated backend endpoint.
- **Caution**: Ensure this is implemented modularly to prevent breaking existing streaming stability.
