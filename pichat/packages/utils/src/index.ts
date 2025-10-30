import { ulid } from 'ulid';
import type { Logger } from '@pichat/types';

export const createLogger = (namespace: string): Logger => {
  const format = (level: string, message: string, meta: unknown[]) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console[level](`[${timestamp}] [${namespace}] ${message}`, ...meta);
  };

  return {
    debug: (message, ...meta) => format('debug', message, meta),
    info: (message, ...meta) => format('log', message, meta),
    warn: (message, ...meta) => format('warn', message, meta),
    error: (message, ...meta) => format('error', message, meta),
  };
};

export const now = () => Date.now();

export const toBase64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

export const fromBase64 = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'));

export const createUlid = (): string => ulid();

export const chunkBuffer = (buffer: Uint8Array, chunkSize: number): Uint8Array[] => {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be positive');
  }

  const result: Uint8Array[] = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    result.push(buffer.slice(offset, offset + chunkSize));
  }
  return result;
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
