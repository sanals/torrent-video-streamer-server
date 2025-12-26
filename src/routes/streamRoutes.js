import { Router } from 'express';
import { streamVideo, streamVideoTranscoded } from '../controllers/streamController.js';
import { validateFileIndexParam, validateInfoHashParam } from '../middleware/validators.js';

const router = Router();

// GET /api/stream/:infoHash/:fileIndex - Stream video file (direct)
router.get('/stream/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamVideo);

// GET /api/stream-transcoded/:infoHash/:fileIndex - Stream with audio transcoded to AAC
router.get('/stream-transcoded/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamVideoTranscoded);

export default router;
