import { registerAs } from '@nestjs/config';

/**
 * Cloudinary configuration.
 *
 * Used by export/import job processors to upload and retrieve CSV/XLSX files.
 * Credentials are loaded from environment variables — never hard-code them.
 *
 * @see https://cloudinary.com/documentation/node_integration
 */
export default registerAs('cloudinary', () => ({
  /** Cloudinary cloud name (displayed in the dashboard URL). */
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,

  /** Cloudinary API key. */
  apiKey: process.env.CLOUDINARY_API_KEY,

  /** Cloudinary API secret. Keep this server-side only — never expose to clients. */
  apiSecret: process.env.CLOUDINARY_API_SECRET,
}));
