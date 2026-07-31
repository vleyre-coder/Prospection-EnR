import pino from 'pino';
import { config } from './config.js';

export const journal = pino({
  level: config.niveauLog,
  transport:
    config.env === 'development'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  base: undefined,
});
