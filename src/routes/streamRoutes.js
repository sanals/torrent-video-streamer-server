import { Router } from 'express';
import * as streamController from '../controllers/streamController.js';
import { validateFileIndexParam, validateInfoHashParam } from '../middleware/validators.js';

const router = Router();

// GET /api/stream/:infoHash/:fileIndex - Stream video file
router.get('/stream/:infoHash/:fileIndex', validateInfoHashParam, validateFileIndexParam, streamController.streamVideo);

export default router;
