import fastify from 'fastify';
import cors from '@fastify/cors';

const app = fastify({ logger: false });
await app.register(cors, { origin: true });

app.get('/', async () => ({ status: 'ok', name: 'Vin Play Streaming API' }));

// TMDB Meta (proxied)
app.get('/meta/tmdb/trending', async (req) => {
  const resp = await fetch(`https://consumet-api-eta.vercel.app/meta/tmdb/trending?page=${req.query.page || '1'}&media=${req.query.media || 'movie'}`);
  return resp.json();
});

app.get('/meta/tmdb/:query', async (req) => {
  const resp = await fetch(`https://consumet-api-eta.vercel.app/meta/tmdb/${req.params.query}?page=${req.query.page || '1'}`);
  return resp.json();
});

// FlixHQ search
app.get('/movies/flixhq/search/:query', async (req) => {
  const { default: FlixHQ } = await import('@consumet/extensions/dist/providers/movies/flixhq.js');
  const flixhq = new FlixHQ();
  try {
    const data = await flixhq.search(req.params.query, req.query.page || '1');
    return data;
  } catch (e) { return { results: [], error: e.message }; }
});

app.get('/movies/flixhq/info', async (req) => {
  const { default: FlixHQ } = await import('@consumet/extensions/dist/providers/movies/flixhq.js');
  const flixhq = new FlixHQ();
  try {
    if (!req.query.id) return { error: 'Missing id' };
    const data = await flixhq.fetchMediaInfo(req.query.id);
    return data;
  } catch (e) { return { error: e.message }; }
});

app.get('/movies/flixhq/watch', async (req) => {
  const { default: FlixHQ } = await import('@consumet/extensions/dist/providers/movies/flixhq.js');
  const flixhq = new FlixHQ();
  try {
    if (!req.query.episodeId) return { error: 'Missing episodeId' };
    const data = await flixhq.fetchEpisodeSources(req.query.episodeId, req.query.mediaId);
    return data;
  } catch (e) { return { error: e.message }; }
});

const port = parseInt(process.env.PORT || '3000');
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Vin Play Streaming API running on port ${port}`);
});
