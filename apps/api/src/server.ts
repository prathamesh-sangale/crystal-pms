import { buildApp } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';

const app = await buildApp();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`ReeferReady PMS API on http://localhost:${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
