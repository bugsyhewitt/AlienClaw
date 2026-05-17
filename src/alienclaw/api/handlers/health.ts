import type { HealthResponse } from '../types.js';

const _SERVER_VERSION = '1.0.0';
const _START_TIME = Date.now();

export function handleHealth(): [number, HealthResponse] {
  return [200, {
    status:         'ok',
    version:        _SERVER_VERSION,
    uptime_seconds: Math.floor((Date.now() - _START_TIME) / 1000),
  }];
}
