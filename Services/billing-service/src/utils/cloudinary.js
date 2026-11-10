import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { agencyFolder } from '../../../shared/tenancy/src/index.js';

const LINK_TTL_SECONDS = 24 * 60 * 60;

let configured = false;

/** Configure Cloudinary from env once. Returns false when creds are absent. */
function ensureConfigured() {
  if (configured) return true;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  configured = true;
  return true;
}

export const isCloudinaryConfigured = () => ensureConfigured();

/**
 * Upload a PDF as a private asset under a random name and return a signed
 * download link that expires after 24 hours (long enough for WhatsApp to fetch it).
 * @throws {Error} when Cloudinary is not configured
 */
export function uploadPdfBuffer(buffer) {
  if (!ensureConfigured()) {
    throw new Error('Cloudinary is not configured (set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)');
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', type: 'private', folder: agencyFolder('documents'), public_id: `${crypto.randomUUID()}.pdf` },
      (error, result) => {
        if (error) return reject(error);
        resolve(cloudinary.utils.private_download_url(result.public_id, undefined, {
          resource_type: 'raw',
          type: 'private',
          expires_at: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS,
        }));
      },
    );
    stream.end(buffer);
  });
}

export default { isCloudinaryConfigured, uploadPdfBuffer };
