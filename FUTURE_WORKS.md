# Planned Improvements - TV Streamer

This document outlines the next set of prioritized tasks for the TV Streamer project.

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
