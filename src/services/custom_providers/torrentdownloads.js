import cheerio from 'cheerio';

const TorrentDownloads = {
    name: 'TorrentDownloads',
    baseUrl: 'https://www.torrentdownloads.pro',
    searchUrl: '/search/?search={query}&s_cat={cat}',
    categories: {
        'All': '0',
        'Movies': '4',
        'TV': '8',
        'Games': '3',
        'Music': '5',
        'Anime': '1',
        'Books': '2',
        'Software': '7',
        'Other': '9'
    },
    defaultCategory: 'All',
    magnetSelector: 'a[href^="magnet:"]@href', // Fallback
    requireDetails: true,

    search: async function (query, cat, limit) {
        let catId = '0';
        if (cat && this.categories[cat]) {
            catId = this.categories[cat];
        }

        const url = `${this.baseUrl}/search/?search=${encodeURIComponent(query)}&s_cat=${catId}`;

        const results = [];
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!res.ok) {
                console.error(`TorrentDownloads fetch failed: ${res.status}`);
                return [];
            }

            const html = await res.text();
            // Check for ISP block page or very short content (often block pages are small but 200 OK)
            if (html.length < 1000 && (html.includes('iframe') || html.includes('court'))) {
                console.warn('TorrentDownloads appears to be blocked by ISP.');
                return [];
            }

            const $ = cheerio.load(html);

            const rows = $('.inner_container .grey_bar3');

            rows.each((i, elem) => {
                const titleElem = $(elem).find('p > a');
                const title = titleElem.text().trim();
                const link = titleElem.attr('href');

                if (!link || !link.startsWith('/torrent/')) return;

                const spans = $(elem).find('span');
                const peersStr = spans.eq(1).text().trim();
                const seedsStr = spans.eq(2).text().trim();
                const size = spans.eq(3).text().trim();

                results.push({
                    title: title,
                    desc: link,
                    seeds: parseInt(seedsStr, 10) || 0,
                    peers: parseInt(peersStr, 10) || 0,
                    size: size,
                    provider: 'TorrentDownloads'
                });
            });

            if (limit && limit > 0) {
                return results.slice(0, limit);
            }

        } catch (err) {
            console.error('TorrentDownloads Search Error:', err.message);
        }
        return results;
    },

    getMagnet: async function (torrent) {
        const url = this.baseUrl + torrent.desc;
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            const html = await res.text();
            const $ = cheerio.load(html);
            const magnet = $('a[href^="magnet:"]').attr('href');
            return magnet;
        } catch (e) {
            console.error('TD getMagnet error:', e.message);
            return null;
        }
    }
};

export default TorrentDownloads;
