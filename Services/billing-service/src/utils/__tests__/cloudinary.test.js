import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUploadStream, mockPrivateDownloadUrl } = vi.hoisted(() => ({
  mockUploadStream: vi.fn(),
  mockPrivateDownloadUrl: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: { upload_stream: mockUploadStream },
    utils: { private_download_url: mockPrivateDownloadUrl },
  },
}));

import { uploadPdfBuffer as upload } from '../cloudinary.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const AGENCY = '11111111-1111-4111-8111-111111111111';
// Uploads happen inside a request, so inside an agency.
const uploadPdfBuffer = (buffer) => runWithTenant(AGENCY, () => upload(buffer));

const NOW = new Date('2026-11-08T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  Object.assign(process.env, {
    CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  });
  mockUploadStream.mockImplementation((options, callback) => ({
    end: () => callback(null, { public_id: `${options.folder}/${options.public_id}` }),
  }));
  mockPrivateDownloadUrl.mockReturnValue('https://api.cloudinary.com/signed-download');
});

afterEach(() => {
  vi.useRealTimers();
});

const uploadOptions = () => mockUploadStream.mock.calls[0][0];

describe('uploadPdfBuffer', () => {
  it('uploads the PDF as a private asset', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(uploadOptions().type).toBe('private');
  });

  it('names the file with a random id rather than a document number', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(uploadOptions().public_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
  });

  it('gives each upload a different name', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));
    await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(mockUploadStream.mock.calls[0][0].public_id).not.toBe(mockUploadStream.mock.calls[1][0].public_id);
  });

  it('never overwrites an existing file', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(uploadOptions().overwrite).toBeUndefined();
  });

  it('returns a signed private download link for the uploaded file', async () => {
    const url = await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(url).toBe('https://api.cloudinary.com/signed-download');
    expect(mockPrivateDownloadUrl).toHaveBeenCalledWith(
      `travel-crm/tenants/${AGENCY}/documents/${uploadOptions().public_id}`,
      undefined,
      expect.objectContaining({ resource_type: 'raw', type: 'private' }),
    );
  });

  it('makes the download link expire 24 hours after upload', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));

    const { expires_at } = mockPrivateDownloadUrl.mock.calls[0][2];
    expect(expires_at).toBe(NOW.getTime() / 1000 + 24 * 60 * 60);
  });

  it('rejects when Cloudinary reports an upload error', async () => {
    mockUploadStream.mockImplementation((_options, callback) => ({ end: () => callback(new Error('quota exceeded')) }));

    await expect(uploadPdfBuffer(Buffer.from('%PDF'))).rejects.toThrow('quota exceeded');
  });

  it('stores the PDF in the folder of the agency', async () => {
    await uploadPdfBuffer(Buffer.from('%PDF'));

    expect(uploadOptions().folder).toBe(`travel-crm/tenants/${AGENCY}/documents`);
  });

  it('refuses to store a PDF without an agency', async () => {
    await expect(upload(Buffer.from('%PDF'))).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
    expect(mockUploadStream).not.toHaveBeenCalled();
  });
});
