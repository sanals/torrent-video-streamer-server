import { Router } from 'express';
import * as torrentController from '../controllers/torrentController.js';
import { validateFileIndexParam, validateInfoHashParam, validateMagnetBody } from '../middleware/validators.js';

const router = Router();

// POST /api/torrents - Add new torrent (supports both magnet URI and .torrent file)
router.post('/torrents', torrentController.upload.single('torrentFile'), validateMagnetBody, torrentController.addTorrent);

// GET /api/torrents - Get all torrents
router.get('/torrents', torrentController.getAllTorrents);

// GET /api/torrents/:infoHash - Get specific torrent
router.get('/torrents/:infoHash', validateInfoHashParam, torrentController.getTorrent);

// GET /api/torrents/:infoHash/progress - Get torrent progress
router.get('/torrents/:infoHash/progress', validateInfoHashParam, torrentController.getTorrentProgress);

// DELETE /api/torrents/:infoHash - Remove torrent
router.delete('/torrents/:infoHash', validateInfoHashParam, torrentController.removeTorrent);

// POST /api/torrents/:infoHash/pause - Pause torrent
router.post('/torrents/:infoHash/pause', validateInfoHashParam, torrentController.pauseTorrent);

// POST /api/torrents/:infoHash/resume - Resume torrent
router.post('/torrents/:infoHash/resume', validateInfoHashParam, torrentController.resumeTorrent);

// POST /api/torrents/:infoHash/files/:fileIndex/prioritize - Prioritize file for streaming
router.post('/torrents/:infoHash/files/:fileIndex/prioritize', validateInfoHashParam, validateFileIndexParam, torrentController.prioritizeFile);

// POST /api/torrents/:infoHash/video/play - Video play event (resume download)
router.post('/torrents/:infoHash/video/play', validateInfoHashParam, torrentController.onVideoPlay);

// POST /api/torrents/:infoHash/video/pause - Video pause event (pause download)
router.post('/torrents/:infoHash/video/pause', validateInfoHashParam, torrentController.onVideoPause);

export default router;
