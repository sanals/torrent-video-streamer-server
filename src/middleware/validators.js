export function validateInfoHashParam(req, res, next) {
    const { infoHash } = req.params;

    if (typeof infoHash !== 'string' || infoHash.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid infoHash' });
    }

    const normalized = infoHash.trim();
    const isHex40 = /^[a-fA-F0-9]{40}$/.test(normalized);

    if (!isHex40) {
        return res.status(400).json({ success: false, error: 'Invalid infoHash' });
    }

    return next();
}

export function validateFileIndexParam(req, res, next) {
    const { fileIndex } = req.params;
    const idx = Number.parseInt(fileIndex, 10);

    if (!Number.isFinite(idx) || Number.isNaN(idx) || idx < 0) {
        return res.status(400).json({ success: false, error: 'Invalid fileIndex' });
    }

    return next();
}

export function validateMagnetBody(req, res, next) {
    if (req.file) return next();

    const { magnetURI } = req.body;

    if (typeof magnetURI !== 'string' || magnetURI.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Either magnetURI or torrent file is required' });
    }

    if (!magnetURI.startsWith('magnet:?')) {
        return res.status(400).json({ success: false, error: 'Invalid magnet URI format' });
    }

    return next();
}
