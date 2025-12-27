import { Router } from 'express';
import * as streamController from '../controllers/streamController.js';
import * as mseStreamController from '../controllers/mseStreamController.js';
import { validateFileIndexParam, validateInfoHashParam } from '../middleware/validators.js';

const router = Router();

// GET /api/stream/:infoHash/:fileIndex - Stream video file (direct)
router.get('/stream/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.streamVideo);

// GET /api/stream/:infoHash/:fileIndex/info - Get stream info (audio tracks)
router.get('/stream/:infoHash/:fileIndex/info', validateInfoHashParam, validateFileIndexParam, streamController.getStreamInfo);

// GET /api/stream-transcoded/:infoHash/:fileIndex - Stream with audio transcoded to AAC
router.get('/stream-transcoded/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.streamVideoTranscoded);

// MSE (Media Source Extensions) streaming endpoints
// GET /api/stream-mse/:infoHash/:fileIndex/init - Get initialization segment (ftyp + moov)
router.get('/stream-mse/:infoHash/:fileIndex/init', validateInfoHashParam, validateFileIndexParam, mseStreamController.getInitSegment);

// GET /api/stream-mse/:infoHash/:fileIndex/segment - Get media segment for time range
router.get('/stream-mse/:infoHash/:fileIndex/segment', validateInfoHashParam, validateFileIndexParam, mseStreamController.getMediaSegment);

// GET /api/stream-mse/:infoHash/:fileIndex/manifest - Get stream manifest/metadata
router.get('/stream-mse/:infoHash/:fileIndex/manifest', validateInfoHashParam, validateFileIndexParam, mseStreamController.getManifest);

// GET /api/raw/:infoHash/:fileIndex - Serve raw file with Range support (for FFmpeg loopback)
router.get('/raw/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.getRawFile);

export default router;
