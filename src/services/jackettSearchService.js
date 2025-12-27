import axios from 'axios';
import config from '../config/index.js';

class JackettSearchService {
    constructor() {
        this.baseUrl = config.jackett.url;
        this.apiKey = config.jackett.apiKey;
    }

    /**
     * Search torrents via Jackett API
     * @param {string} query Search term
     * @param {Object} options Search options
     * @returns {Promise<Array>} Standardized torrent results
     */
    async searchTorrents(query, options = {}) {
        if (!config.jackett.enabled) {
            console.log('Jackett is not enabled or API key missing.');
            return [];
        }

        try {
            // Jackett uses Torznab API. We request JSON format for easier parsing.
            // t=search is the general search command
            // q=query is the search term
            const response = await axios.get(`${this.baseUrl}/api/v2.0/indexers/all/results`, {
                params: {
                    apikey: this.apiKey,
                    Query: query,
                    format: 'json'
                },
                timeout: config.jackett.timeout
            });

            if (!response.data || !response.data.Results) {
                console.log('No results found in Jackett response.');
                return [];
            }

            // Map Jackett results to our standard format
            return response.data.Results.map(result => ({
                name: result.Title || 'Unknown',
                magnetURI: result.MagnetUri || this.getAlternativeMagnet(result),
                size: result.Size || 0,
                seeders: result.Seeders || 0,
                leechers: result.Peers || 0,
                category: result.CategoryDesc || 'Other',
                uploadDate: result.PublishDate || new Date().toISOString(),
                source: result.Tracker || 'Jackett',
                infoPage: result.Comments || result.Guid || null,
                link: result.Link || null
            })).filter(result => result.magnetURI); // We need magnets for streaming

        } catch (error) {
            console.error('Jackett Search Error:', error.message);
            if (error.response) {
                console.error('Response Status:', error.response.status);
            }
            return [];
        }
    }

    /**
     * Some indexers might have magnet in another field or need a redirect
     */
    getAlternativeMagnet(result) {
        if (result.MagnetUri) return result.MagnetUri;
        // Sometimes Link is a magnet link directly
        if (result.Link && result.Link.startsWith('magnet:')) return result.Link;
        return null;
    }

    async testConnection() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v2.0/indexers/all/results`, {
                params: {
                    apikey: this.apiKey,
                    Query: 'test',
                    format: 'json'
                },
                timeout: 5000
            });
            return response.status === 200;
        } catch (e) {
            console.error('Jackett connection test failed:', e.message);
            return false;
        }
    }
}

export default new JackettSearchService();
