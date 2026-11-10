import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { package: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../services/package.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  serializePackage: (pkg) => ({ id: pkg.id, isActive: pkg.isActive }),
}));

import { getPackageById } from '../package.controller.js';

async function view(pkg, user) {
  prismaMock.package.findUnique.mockResolvedValue(pkg);
  const res = { json: vi.fn() };
  let error;
  await getPackageById({ params: { id: 'pkg-1' }, user }, res, (err) => { error = err; });
  return { res, error };
}

const draft = { id: 'pkg-1', isActive: false };
const live = { id: 'pkg-1', isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.package.update.mockResolvedValue({});
});

describe('getPackageById', () => {
  it('shows an active package to anonymous visitors', async () => {
    const { res } = await view(live);

    expect(res.json.mock.calls[0][0].data.id).toBe('pkg-1');
  });

  it('hides an inactive package from anonymous visitors', async () => {
    const { error } = await view(draft);

    expect(error.statusCode).toBe(404);
  });

  it('hides an inactive package from signed-in customers', async () => {
    const { error } = await view(draft, { role: 'customer' });

    expect(error.statusCode).toBe(404);
  });

  it('does not count a view of a hidden package', async () => {
    await view(draft);

    expect(prismaMock.package.update).not.toHaveBeenCalled();
  });

  it.each(['admin', 'staff', 'salesRep', 'superAdmin'])('shows an inactive package to %s', async (role) => {
    const { res } = await view(draft, { role });

    expect(res.json.mock.calls[0][0].data.isActive).toBe(false);
  });

  it('returns 404 for a package that does not exist', async () => {
    const { error } = await view(null, { role: 'admin' });

    expect(error.statusCode).toBe(404);
  });
});
