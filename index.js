const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const NodeCache = require('node-cache');

const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const PORT = process.env.PORT || 3000;
const FETCH_INTERVAL = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 10000;
const ALLOWED_LANGUAGES = ['eng', 'hin', 'ben'];

const LANGUAGE_MAP = {
    English: 'eng',
    Bangla: 'ben',
    Hindi: 'hin',
};

const cache = new NodeCache({ stdTTL: FETCH_INTERVAL / 1000 });

const manifest = {
    id: 'org.iptv',
    name: 'IPTV Addon',
    version: '0.0.6',
    description: 'Watch live TV categorized by genre and language!',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [
        {
            type: 'tv',
            id: 'All',
            name: 'All Channels',
            extra: [
                { name: 'skip' },
                { name: 'limit' },
                { name: 'genre', options: ['English', 'Bangla', 'Hindi'] },
            ],
        },
        { type: 'tv', id: 'Entertainment', name: 'Entertainment', extra: [{ name: 'skip' }, { name: 'limit' }, { name: 'genre', options: ['English', 'Bangla', 'Hindi'] }] },
        { type: 'tv', id: 'News', name: 'News', extra: [{ name: 'skip' }, { name: 'limit' }, { name: 'genre', options: ['English', 'Bangla', 'Hindi'] }] },
        { type: 'tv', id: 'Sports', name: 'Sports', extra: [{ name: 'skip' }, { name: 'limit' }, { name: 'genre', options: ['English', 'Bangla', 'Hindi'] }] },
        { type: 'tv', id: 'Kids', name: 'Kids', extra: [{ name: 'skip' }, { name: 'limit' }, { name: 'genre', options: ['English', 'Bangla', 'Hindi'] }] },
        { type: 'tv', id: 'Movies', name: 'Movies', extra: [{ name: 'skip' }, { name: 'limit' }, { name: 'genre', options: ['English', 'Bangla', 'Hindi'] }] },
    ],
    idPrefixes: ['iptv-'],
};

const addon = new addonBuilder(manifest);

const fetchChannels = async () => {
    try {
        const response = await axios.get(IPTV_CHANNELS_URL, { timeout: FETCH_TIMEOUT });
        return response.data.filter(
            (channel) => channel.languages && channel.languages.some((lang) => ALLOWED_LANGUAGES.includes(lang))
        );
    } catch (error) {
        return [];
    }
};

const fetchStreams = async () => {
    try {
        const response = await axios.get(IPTV_STREAMS_URL, { timeout: FETCH_TIMEOUT });
        return response.data;
    } catch (error) {
        return [];
    }
};

const updateCatalogCache = async () => {
    try {
        const [channels, streams] = await Promise.all([fetchChannels(), fetchStreams()]);
        const streamMap = new Map(streams.map((stream) => [stream.channel, stream]));

        const catalogByGenreAndLanguage = {
            all: { eng: [], ben: [], hin: [] },
            entertainment: { eng: [], ben: [], hin: [] },
            news: { eng: [], ben: [], hin: [] },
            sports: { eng: [], ben: [], hin: [] },
            kids: { eng: [], ben: [], hin: [] },
            movies: { eng: [], ben: [], hin: [] },
        };

        channels.forEach((channel) => {
            const stream = streamMap.get(channel.id);
            if (stream) {
                const genres = (channel.categories || []).map((category) => category.toLowerCase());
                const meta = {
                    id: `iptv-${channel.id}`,
                    name: channel.name,
                    type: 'tv',
                    poster: channel.logo || 'generated-icon.png',
                    genres,
                };

                (channel.languages || []).forEach((lang) => {
                    if (catalogByGenreAndLanguage.all[lang]) {
                        catalogByGenreAndLanguage.all[lang].push(meta);
                    }
                });

                genres.forEach((genre) => {
                    if (catalogByGenreAndLanguage[genre]) {
                        (channel.languages || []).forEach((lang) => {
                            if (catalogByGenreAndLanguage[genre][lang]) {
                                catalogByGenreAndLanguage[genre][lang].push(meta);
                            }
                        });
                    }
                });
            }
        });

        cache.set('catalogByGenreAndLanguage', catalogByGenreAndLanguage);
    } catch (error) {}
};

addon.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'tv') return { metas: [] };

    const catalogByGenreAndLanguage = cache.get('catalogByGenreAndLanguage') || {};
    const genre = extra.genre || 'English';
    const language = LANGUAGE_MAP[genre] || 'eng';

    const catalog = id === 'All' ? catalogByGenreAndLanguage.all : catalogByGenreAndLanguage[id.toLowerCase()];
    if (!catalog) return { metas: [] };

    const languageChannels = catalog[language] || [];
    return {
        metas: languageChannels.slice(extra.skip || 0, (extra.skip || 0) + (extra.limit || 15)),
    };
});

addon.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'tv') return { meta: {} };

    const catalogByGenreAndLanguage = cache.get('catalogByGenreAndLanguage') || {};
    const allChannels = Object.values(catalogByGenreAndLanguage.all || {}).flat();
    const meta = allChannels.find((item) => item.id === id);

    return { meta: meta || {} };
});

addon.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'tv') return { streams: [] };

    const channelId = id.replace('iptv-', '');
    const streams = cache.get('streams') || (await fetchStreams());
    const stream = streams.find((s) => s.channel === channelId);

    if (stream) {
        return { streams: [{ url: stream.url }] };
    }

    return { streams: [] };
});

(async () => {
    await updateCatalogCache();
    setInterval(updateCatalogCache, FETCH_INTERVAL);
})();

serveHTTP(addon.getInterface(), { port: PORT });
