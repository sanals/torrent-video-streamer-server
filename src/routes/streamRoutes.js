import { Router } from 'express';
import * as streamController from '../controllers/streamController.js';
import { validateFileIndexParam, validateInfoHashParam } from '../middleware/validators.js';

const router = Router();

// GET /api/stream/:infoHash/:fileIndex - Stream video file (direct)
router.get('/stream/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.streamVideo);

// GET /api/stream/:infoHash/:fileIndex/info - Get stream info (audio tracks)
router.get('/stream/:infoHash/:fileIndex/info', validateInfoHashParam, validateFileIndexParam, streamController.getStreamInfo);

// GET /api/stream-transcoded/:infoHash/:fileIndex - Stream with audio transcoded to AAC
router.get('/stream-transcoded/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.streamVideoTranscoded);

export default router;
