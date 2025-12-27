import torrentManager from '../torrent/TorrentManager.js';
import { spawn } from 'child_process';
import { PassThrough, Transform } from 'stream';

// Segment duration in seconds
const SEGMENT_DURATION = 6;

// Simple in-memory cache for init segments (they're small and reusable)
const initSegmentCache = new Map();
// Cache for file metadata (duration, codec info) to optimize seeking
const metadataCache = new Map();

/**
 * Get the initialization segment (ftyp + moov) for MSE playback.
 * This segment contains codec info and is required before any media segments.
 * 
 * GET /api/stream-mse/:infoHash/:fileIndex/init?audioTrack=0
 */
export async function getInitSegment(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;
        const audioTrackIndex = req.query.audioTrack ? parseInt(req.query.audioTrack, 10) : 0;

        const cacheKey = `${infoHash}:${fileIndex}:${audioTrackIndex}`;

        // Check cache first
        if (initSegmentCache.has(cacheKey)) {
            const cached = initSegmentCache.get(cacheKey);
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(cached);
        }

        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({ success: false, error: 'Torrent not found' });
        }

        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Prioritize file for streaming
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // Determine if video needs transcoding
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const likelyHevc = /\b(hevc|x265)\b/i.test(fileName);
        const needsVideoTranscode = ext === 'mkv' || ext === 'avi' || ext === 'ts' || likelyHevc;

        const videoArgs = needsVideoTranscode
            ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']
            : ['-c:v', 'copy'];

        // Generate init segment by transcoding a tiny portion
        // We use -t 0.1 to get just enough for the init segment
        const args = [
            '-hide_banner', '-loglevel', 'error',
            '-i', 'pipe:0',
            '-t', '0.1',
            '-map', '0:v:0?',
            `-map`, `0:a:${audioTrackIndex}?`,
            ...videoArgs,
            '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-f', 'mp4',
            'pipe:1'
        ];

        const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        const chunks = [];

        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });

        ffmpeg.stderr.on('data', (data) => {
            if (process.env.NODE_ENV === 'development') {
                console.warn('ffmpeg init:', data.toString().trim());
            }
        });

        ffmpeg.on('error', (err) => {
            console.error('❌ ffmpeg init error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'FFmpeg error' });
            }
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0 && chunks.length === 0) {
                if (!res.headersSent) {
                    return res.status(500).json({ success: false, error: `FFmpeg exited with code ${code}` });
                }
                return;
            }

            // Don't try to send response if already sent
            if (res.headersSent) {
                return;
            }

            const initSegment = Buffer.concat(chunks);

            // Cache the init segment
            initSegmentCache.set(cacheKey, initSegment);

            // Limit cache size
            if (initSegmentCache.size > 50) {
                const firstKey = initSegmentCache.keys().next().value;
                initSegmentCache.delete(firstKey);
            }

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(initSegment);
        });

        // Read first 10MB to generate init segment
        const INIT_READ_SIZE = 10 * 1024 * 1024;
        const end = Math.min(file.length - 1, INIT_READ_SIZE);
        const input = file.createReadStream({ start: 0, end });

        input.on('error', (err) => {
            console.error('❌ Torrent stream error:', err.message);
            try { ffmpeg.kill('SIGKILL'); } catch { }
            if (!res.headersSent) {
                res.status(503).json({ success: false, error: 'Torrent data not available yet - please wait for download' });
            }
        });

        // Handle stdin errors (e.g., if ffmpeg closes stdin early)
        ffmpeg.stdin.on('error', (err) => {
            // Ignore EPIPE - this happens when ffmpeg closes stdin on purpose (e.g., got enough data)
            if (err.code !== 'EPIPE' && err.code !== 'EOF') {
                console.error('❌ FFmpeg stdin error:', err.message);
            }
            try { input.destroy(); } catch { }
        });

        input.pipe(ffmpeg.stdin);

        // Cleanup on client disconnect
        req.on('close', () => {
            try { input.destroy(); } catch { }
            try { ffmpeg.kill('SIGKILL'); } catch { }
        });

    } catch (error) {
        next(error);
    }
}

/**
 * Helper to create a transform stream that strips ftyp and moov boxes (init segment)
 * Returns only the moof and mdat boxes (media segment)
 */
function createStripInitStream() {
    let buffer = Buffer.alloc(0);
    let stripped = false;

    return new Transform({
        transform(chunk, encoding, callback) {
            if (stripped) {
                this.push(chunk);
                return callback();
            }

            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= 8) {
                const size = buffer.readUInt32BE(0);
                const type = buffer.toString('ascii', 4, 8);

                if (size === 0) {
                    stripped = true;
                    this.push(buffer);
                    buffer = Buffer.alloc(0);
                    return callback();
                }

                if (type === 'ftyp' || type === 'moov') {
                    // Skip these boxes
                    if (buffer.length >= size) {
                        buffer = buffer.slice(size);
                        // Loop to check next box
                    } else {
                        // Need more data to skip this box
                        return callback();
                    }
                } else {
                    // Found a non-init box (likely moof/styp/prft), we are done stripping
                    stripped = true;
                    this.push(buffer);
                    buffer = Buffer.alloc(0);
                    return callback();
                }
            }
            callback();
        }
    });
}

/**
 * Get a media segment for a specific time range.
 * Returns moof + mdat atoms for the requested time.
 * 
 * GET /api/stream-mse/:infoHash/:fileIndex/segment?t=120&dur=6&audioTrack=0
 */
export async function getMediaSegment(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;
        const startTime = req.query.t ? parseFloat(req.query.t) : 0;
        const duration = req.query.dur ? parseFloat(req.query.dur) : SEGMENT_DURATION;
        const audioTrackIndex = req.query.audioTrack ? parseInt(req.query.audioTrack, 10) : 0;

        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({ success: false, error: 'Torrent not found' });
        }

        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Prioritize file for streaming
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // Determine if video needs transcoding
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const likelyHevc = /\b(hevc|x265)\b/i.test(fileName);
        const needsVideoTranscode = ext === 'mkv' || ext === 'avi' || ext === 'ts' || likelyHevc;

        const videoArgs = needsVideoTranscode
            ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']
            : ['-c:v', 'copy'];

        // HTTP Loopback: Use localhost URL so FFmpeg can use Range requests for seeking
        const serverPort = process.env.PORT || 4000;
        const ffmpegInput = `http://localhost:${serverPort}/api/raw/${infoHash}/${fileIdx}`;

        // Use HTTP Loopback for all segments
        // FFmpeg will use HTTP Range requests if the server supports it and data is available
        console.log(`📦 Generating segment: t=${startTime}s, dur=${duration}s for ${fileName} (HTTP_LOOPBACK)`);

        const args = [
            '-hide_banner', '-loglevel', 'warning',
            // HTTP options for seekable input
            '-seekable', '1',
            '-multiple_requests', '1',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '2',
            // Reduce analysis time
            '-analyzeduration', '2000000',
            '-probesize', '2000000',
            '-fflags', '+genpts+discardcorrupt',
            // Input seeking - FFmpeg will use HTTP Range requests
            '-ss', String(startTime),
            '-i', ffmpegInput,
            '-t', String(duration),
            '-map', '0:v:0?',
            `-map`, `0:a:${audioTrackIndex}?`,
            ...videoArgs,
            '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-frag_duration', '1000000',
            '-f', 'mp4',
            'pipe:1'
        ];

        const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        // Cleanup on disconnect
        req.on('close', () => {
            try { ffmpeg.kill('SIGKILL'); } catch { }
        });

        let headersSent = false;

        ffmpeg.on('error', (err) => {
            console.error('❌ ffmpeg segment error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'FFmpeg error' });
            }
        });


        ffmpeg.stderr.on('data', (data) => {
            if (process.env.NODE_ENV === 'development') {
                console.warn('ffmpeg segment:', data.toString().trim());
            }
        });

        // Set headers and stream response
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache segments for 5 min

        // Create strip stream to remove init segment (ftyp/moov)
        const stripStream = createStripInitStream();

        stripStream.on('data', (chunk) => {
            if (!headersSent) {
                headersSent = true;
                try { res.flushHeaders?.(); } catch { }
            }
            res.write(chunk);
        });

        ffmpeg.stdout.pipe(stripStream);

        ffmpeg.stdout.on('end', () => {
            // Handle via stripStream end? No, stripStream doesn't emit data on end if empty?
            // Actually, when ffmpeg stdout ends, stripStream ends.
            // We need to ensure response ends.
        });

        stripStream.on('end', () => {
            if (!res.writableEnded) res.end();
        });

        stripStream.on('error', (err) => {
            console.error('❌ Strip stream error:', err);
            // attempt to close res if possible
            if (!res.headersSent) res.status(500).end();
            else if (!res.writableEnded) res.end();
        });

        ffmpeg.on('close', (code) => {
            if (!headersSent && code !== 0) {
                console.error(`❌ ffmpeg segment exited with code ${code} before output`);
            }
        });

        // Cleanup on disconnect (no input stream to manage now - FFmpeg fetches via HTTP)
        const cleanup = () => {
            try { ffmpeg.kill('SIGKILL'); } catch { }
        };

        req.on('close', cleanup);

    } catch (error) {
        next(error);
    }
}

/**
 * Get manifest/metadata for MSE playback.
 * Returns duration, segment configuration, and codec info.
 * 
 * GET /api/stream-mse/:infoHash/:fileIndex/manifest?audioTrack=0
 */
export async function getManifest(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;
        const audioTrackIndex = req.query.audioTrack ? parseInt(req.query.audioTrack, 10) : 0;

        const cacheKey = `${infoHash}:${fileIndex}:${audioTrackIndex}`;
        if (metadataCache.has(cacheKey)) {
            return res.json(metadataCache.get(cacheKey));
        }

        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({ success: false, error: 'Torrent not found' });
        }

        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Prioritize file for streaming
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

        // We need a chunk of the file to probe it
        const PROBE_SIZE = 10 * 1024 * 1024;
        const end = Math.min(file.length - 1, PROBE_SIZE);
        const stream = file.createReadStream({ start: 0, end });

        // Spawn ffprobe to get format info
        const ffprobe = spawn(ffprobePath, [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            '-i', 'pipe:0'
        ]);

        let outputData = '';

        ffprobe.stdout.on('data', (data) => {
            outputData += data;
        });

        stream.pipe(ffprobe.stdin);

        stream.on('error', (err) => {
            console.error('Stream error during probe:', err);
            ffprobe.kill();
        });

        ffprobe.on('close', (code) => {
            stream.destroy();

            if (code !== 0 && code !== null) {
                console.error('ffprobe exited with code', code);
                return res.status(500).json({ success: false, error: 'Failed to probe file' });
            }

            try {
                const data = JSON.parse(outputData);
                const duration = parseFloat(data.format?.duration || 0);

                // Find video and audio stream info
                const videoStream = data.streams?.find(s => s.codec_type === 'video');
                const audioStream = data.streams?.filter(s => s.codec_type === 'audio')[audioTrackIndex];

                // Determine MIME type with codecs
                // After transcoding: video will be H.264 (avc1), audio will be AAC (mp4a.40.2)
                const fileName = file.name || '';
                const ext = fileName.split('.').pop()?.toLowerCase() || '';
                const likelyHevc = /\b(hevc|x265)\b/i.test(fileName);
                const needsVideoTranscode = ext === 'mkv' || ext === 'avi' || ext === 'ts' || likelyHevc;

                // If transcoding, output is always H.264 + AAC
                let mimeType;
                if (needsVideoTranscode) {
                    mimeType = 'video/mp4; codecs="avc1.64001f, mp4a.40.2"';
                } else {
                    // For copy mode, detect from source (but we transcode audio anyway)
                    const videoCodec = videoStream?.codec_name === 'h264'
                        ? 'avc1.64001f'
                        : 'avc1.64001f'; // FFmpeg will transcode if needed
                    mimeType = `video/mp4; codecs="${videoCodec}, mp4a.40.2"`;
                }

                const responseData = {
                    success: true,
                    duration,
                    segmentDuration: SEGMENT_DURATION,
                    mimeType,
                    videoWidth: videoStream?.width || 0,
                    videoHeight: videoStream?.height || 0,
                    audioChannels: audioStream?.channels || 2,
                };

                // Cache the successful result
                metadataCache.set(cacheKey, responseData);
                res.json(responseData);

            } catch (e) {
                console.error('Failed to parse ffprobe output:', e);
                // Return defaults
                res.json({
                    success: true,
                    duration: 0,
                    segmentDuration: SEGMENT_DURATION,
                    mimeType: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
                });
            }
        });

        // Timeout if probing takes too long
        setTimeout(() => {
            if (!res.headersSent) {
                ffprobe.kill();
                stream.destroy();
                res.status(504).json({ success: false, error: 'Probe timeout' });
            }
        }, 15000);

    } catch (error) {
        next(error);
    }
}
