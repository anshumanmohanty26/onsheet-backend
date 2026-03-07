import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      url,
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return {
    url: undefined,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: undefined,
  };
});
