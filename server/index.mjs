import { createApp } from './app.mjs';
import { createStore } from './store.mjs';

const store = createStore();
const port = Number(process.env.PORT || 3001);
const server = createApp(store).listen(port, process.env.HOST || '127.0.0.1', () =>
  console.info(`Fun Bench API: http://${process.env.HOST || '127.0.0.1'}:${port}`),
);
function stop() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
