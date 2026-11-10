import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { mockDestroy } = vi.hoisted(() => ({ mockDestroy: vi.fn() }));

vi.mock('../../utils/cloudinary.js', () => ({
  default: { uploader: { destroy: mockDestroy } },
  configureCloudinary: vi.fn(),
}));

// app.js pulls in package.routes.js → db/client.js, which constructs a real
// PrismaClient at import time; mock it so this suite doesn't need DATABASE_URL.
vi.mock('../../db/client.js', () => ({ default: {} }));

const { default: app } = await import('../../app.js');

const DEMO = '00000000-0000-4000-8000-000000000001';
const AGENCY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function authHeaders(tenantId = DEMO) {
  return {
    'x-tenant-id': tenantId,
    'x-user-id': 'agent-1',
    'x-user-role': 'admin',
    'x-user-email': 'agent@test.com',
    'x-user-name': 'Test Agent',
    'x-user-permissions': '[]',
    'x-user-is-super-admin': 'false',
  };
}

describe('DELETE /api/v1/upload/:publicId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('destroys the Cloudinary asset identified by the path param', async () => {
    mockDestroy.mockResolvedValue({ result: 'ok' });

    const res = await request(app)
      .delete('/api/v1/upload/travel-crm%2Fpackages%2Fabc123')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDestroy).toHaveBeenCalledWith('travel-crm/packages/abc123');
  });

  it('deletes an image the agency owns', async () => {
    mockDestroy.mockResolvedValue({ result: 'ok' });

    const res = await request(app)
      .delete(`/api/v1/upload/${encodeURIComponent(`travel-crm/tenants/${AGENCY}/packages/x`)}`)
      .set(authHeaders(AGENCY));

    expect(res.status).toBe(200);
  });

  it('refuses to delete an image of another agency, answering as if it did not exist', async () => {
    const res = await request(app)
      .delete(`/api/v1/upload/${encodeURIComponent(`travel-crm/tenants/${OTHER}/packages/x`)}`)
      .set(authHeaders(AGENCY));

    expect(res.status).toBe(404);
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it('refuses to delete images from before agencies existed unless the agency is the demo one', async () => {
    const res = await request(app)
      .delete('/api/v1/upload/travel-crm%2Fpackages%2Fabc123')
      .set(authHeaders(AGENCY));

    expect(res.status).toBe(404);
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).delete('/api/v1/upload/abc123');
    expect(res.status).toBe(401);
    expect(mockDestroy).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/upload/delete-multiple', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('destroys every publicId in the batch', async () => {
    mockDestroy.mockResolvedValue({ result: 'ok' });

    const res = await request(app)
      .post('/api/v1/upload/delete-multiple')
      .set(authHeaders())
      .send({ publicIds: ['a', 'b', 'c'] });

    expect(res.status).toBe(200);
    expect(mockDestroy).toHaveBeenCalledTimes(3);
  });

  it('refuses the whole batch when any image belongs to another agency', async () => {
    const res = await request(app)
      .post('/api/v1/upload/delete-multiple')
      .set(authHeaders(AGENCY))
      .send({ publicIds: [`travel-crm/tenants/${AGENCY}/a`, `travel-crm/tenants/${OTHER}/b`] });

    expect(res.status).toBe(404);
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it('rejects an empty publicIds array', async () => {
    const res = await request(app)
      .post('/api/v1/upload/delete-multiple')
      .set(authHeaders())
      .send({ publicIds: [] });

    expect(res.status).toBe(400);
    expect(mockDestroy).not.toHaveBeenCalled();
  });
});
