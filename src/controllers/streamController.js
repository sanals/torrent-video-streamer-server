import torrentManager from '../torrent/TorrentManager.js';
import { parseRange, getMimeType } from '../utils/rangeParser.js';
import { spawn, exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

/**
 * Stream video file with range request support
 */
export async function streamVideo(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;
        const range = req.headers.range;

        // Get torrent
        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({
                success: false,
                error: 'Torrent not found',
            });
        }

        // Get file
        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({
                success: false,
                error: 'File not found',
            });
        }

        // Prioritize this file for streaming (selective downloading)
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        const fileSize = file.length;
        const mimeType = getMimeType(file.name);

        // Parse range header
        let start = 0;
        let end = fileSize - 1;
        let statusCode = 200;
        let contentLength = fileSize;

        if (range) {
            const parsedRange = parseRange(range, fileSize);

            if (!parsedRange) {
                return res.status(416).json({
                    success: false,
                    error: 'Range not satisfiable',
                });
            }

            start = parsedRange.start;
            end = parsedRange.end;
            contentLength = end - start + 1;
            statusCode = 206; // Partial Content
        }

        // Set response headers
        const headers = {
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
        };

        if (statusCode === 206) {
            headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
        }

        res.writeHead(statusCode, headers);

        // Create read stream
        const stream = file.createReadStream({ start, end });

        // Handle stream errors
        stream.on('error', (error) => {
            console.error('❌ Stream error:', error.message);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Stream error',
                });
            }
        });

        // Pipe stream to response
        stream.pipe(res);

        // Cleanup on client disconnect
        req.on('close', () => {
            stream.destroy();
        });

    } catch (error) {
        next(error);
    }
}

/**
 * Stream video with browser-compatible audio by transcoding through ffmpeg.
 * 
 * - Audio is transcoded to AAC (browser-compatible)
 * - Video is copied when possible, transcoded to H.264 for HEVC/MKV
 * - Does NOT support seeking (streams from start)
 */
export async function streamVideoTranscoded(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;

        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({ success: false, error: 'Torrent not found' });
        }

        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Prioritize this file for streaming
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

        // Get audio track index from query param (default to 0)
        const audioTrackIndex = req.query.audioTrack ? parseInt(req.query.audioTrack, 10) : 0;

        // Determine if we need to transcode video (HEVC/MKV needs H.264)
        const fileName = file.name || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const likelyHevc = /\b(hevc|x265)\b/i.test(fileName);
        const needsVideoTranscode = ext === 'mkv' || ext === 'avi' || ext === 'ts' || likelyHevc;

        const videoArgs = needsVideoTranscode
            ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']
            : ['-c:v', 'copy'];

        const args = [
            '-hide_banner',
            '-loglevel', 'error',
            '-i', 'pipe:0',                    // Read from stdin
            '-map', '0:v:0?',                  // First video stream
            `-map`, `0:a:${audioTrackIndex}?`, // Selected audio stream (using index)
            ...videoArgs,
            '-c:a', 'aac',                     // Transcode audio to AAC
            '-b:a', '160k',
            '-ac', '2',                        // Stereo
            '-movflags', 'frag_keyframe+empty_moov+faststart',
            '-f', 'mp4',
            'pipe:1',                          // Output to stdout
        ];

        const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        // Handle ffmpeg spawn error
        ffmpeg.on('error', (err) => {
            console.error('❌ ffmpeg spawn error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: `ffmpeg not found. Install ffmpeg or set FFMPEG_PATH.`,
                });
            }
        });

        // Log ffmpeg errors (but don't flood console)
        ffmpeg.stderr.on('data', (chunk) => {
            if (process.env.NODE_ENV === 'development') {
                console.warn('ffmpeg:', chunk.toString().trim());
            }
        });

        // Set response headers
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-store');

        // Create read stream from torrent file
        const input = file.createReadStream();

        input.on('error', (error) => {
            console.error('❌ Torrent stream error:', error.message);
            try { ffmpeg.kill('SIGKILL'); } catch { }
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Stream error' });
            }
        });

        // Pipe torrent -> ffmpeg -> response
        input.pipe(ffmpeg.stdin);

        let started = false;
        ffmpeg.stdout.on('data', (chunk) => {
            if (!started) {
                started = true;
                try { res.flushHeaders?.(); } catch { }
            }
            res.write(chunk);
        });

        ffmpeg.stdout.on('end', () => {
            if (!res.writableEnded) res.end();
        });

        ffmpeg.stdout.on('error', () => {
            if (!res.writableEnded) res.end();
        });

        // Cleanup on disconnect or completion
        const cleanup = () => {
            try { input.destroy(); } catch { }
            try { ffmpeg.stdin.destroy(); } catch { }
            try { ffmpeg.kill('SIGKILL'); } catch { }
        };

        req.on('close', cleanup);
        ffmpeg.on('close', (code) => {
            if (!started && code && code !== 0) {
                console.error(`❌ ffmpeg exited with code ${code} before output`);
            }
            cleanup();
        });

    } catch (error) {
        next(error);
    }
}

/**
 * Get stream info (audio tracks, codecs) using ffprobe
 */
export async function getStreamInfo(req, res, next) {
    try {
        const { infoHash, fileIndex } = req.params;

        const torrent = torrentManager.getTorrentByInfoHash(infoHash);
        if (!torrent) {
            return res.status(404).json({ success: false, error: 'Torrent not found' });
        }

        const fileIdx = parseInt(fileIndex, 10);
        const file = torrent.files[fileIdx];

        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Prioritize file to ensure we have enough data for probing
        torrentManager.prioritizeFileForStreaming(infoHash, fileIdx);

        // We need a small chunk of the file to probe it. 
        // We'll stream the first 10MB to ffprobe via stdin
        const PROBE_SIZE = 10 * 1024 * 1024;
        const end = Math.min(file.length - 1, PROBE_SIZE);

        const stream = file.createReadStream({ start: 0, end });
        const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

        // Spawn ffprobe to read from stdin
        const ffprobe = spawn(ffprobePath, [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-select_streams', 'a', // Only audio streams
            '-i', 'pipe:0'
        ]);

        let outputData = '';
        let errorData = '';

        ffprobe.stdout.on('data', (data) => {
            outputData += data;
        });

        ffprobe.stderr.on('data', (data) => {
            errorData += data;
        });

        stream.pipe(ffprobe.stdin);

        // Handle stream errors
        stream.on('error', (err) => {
            console.error('Stream error during probe:', err);
            ffprobe.kill();
        });

        // Handle ffprobe completion
        ffprobe.on('close', (code) => {
            // Clean up stream if still open
            stream.destroy();

            if (code !== 0 && code !== null) {
                console.error('ffprobe exited with code', code, errorData);
                return res.status(500).json({ success: false, error: 'Failed to probe file' });
            }

            try {
                const data = JSON.parse(outputData);
                const audioTracks = data.streams.map((stream, index) => ({
                    index: index, // This is the relative index among audio streams
                    codec: stream.codec_name,
                    channels: stream.channels,
                    language: stream.tags?.language || 'und',
                    title: stream.tags?.title || stream.tags?.handler_name
                }));

                res.json({
                    success: true,
                    audioTracks
                });
            } catch (e) {
                console.error('Failed to parse ffprobe output:', e);
                // Fallback if parsing fails (maybe not enough data yet)
                res.json({ success: true, audioTracks: [] });
            }
        });

        // Timeout if probing takes too long (e.g. if download is stuck)
        setTimeout(() => {
            if (!res.headersSent) {
                ffprobe.kill();
                stream.destroy();
                res.status(504).json({ success: false, error: 'Probe timeout - file might not be downloaded enough' });
            }
        }, 10000);

    } catch (error) {
        next(error);
    }
}
