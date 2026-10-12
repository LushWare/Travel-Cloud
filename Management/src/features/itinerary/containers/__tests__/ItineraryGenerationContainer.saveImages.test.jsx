import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Regression coverage for root cause #2 (see plan): handleSaveEditPackage used
// to filter `images` by `!img.isTemp && img.url && img.public_id` before
// building the save payload. Images loaded from the API (serializePackage)
// never carry `public_id`, so every pre-existing image silently dropped out
// of the payload on every edit-save. This test loads a package with two
// DB-persisted images (no public_id, only the new camelCase `publicId`) and
// asserts both survive an edit-save untouched.

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'superAdmin' } }),
}));
vi.mock('../../../../contexts/PermissionContext', () => ({
  usePermission: () => ({ hasPermission: () => true }),
}));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
vi.mock('../../../../services/cloudinaryService', () => ({
  uploadPackageImages: vi.fn(),
  deleteImage: vi.fn(),
}));

const { mockApiService } = vi.hoisted(() => ({
  mockApiService: {
    getPackageStats: vi.fn(),
    getPackages: vi.fn(),
    getPackagesProtected: vi.fn(),
    getPackage: vi.fn(),
    updatePackage: vi.fn(),
    deletePackageImage: vi.fn(),
    setPackageCover: vi.fn(),
  },
}));
vi.mock('../../services/apiService', () => ({ default: mockApiService }));

vi.mock('../../components', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    PackageDetailsModal: () => null,
    PackagePDFPreviewDialog: () => null,
    AIPackageDialog: () => null,
    // The regression is in the container's save-payload construction, not the
    // form UI — stub the (heavy) real form with a button that triggers the
    // container's own onSave the same way a real submit would. NewEditPackageForm
    // now owns its own Dialog/isOpen gating internally (previously provided by
    // the real PackageFormModal wrapper), so the stub must respect `isOpen`
    // itself — otherwise both the New and Edit package stubs would render
    // simultaneously and collide on the "Stub Save" role query.
    NewEditPackageForm: ({ isOpen, onSave }) => (
      isOpen ? <button onClick={() => onSave()}>Stub Save</button> : null
    ),
  };
});

import ItineraryGenerationContainer from '../ItineraryGenerationContainer';

const persistedPackage = {
  id: 'pkg-1',
  title: 'Alps Adventure',
  destination: 'Switzerland',
  category: 'FAMILY',
  durationDays: 5,
  basePrice: 1000,
  sellPrice: 1200,
  isActive: true,
  isFeatured: false,
  coverImage: null,
  images: [
    { id: 'img-1', url: 'https://cdn/a.jpg', publicId: 'p-a', altText: null, orderIndex: 0 },
    { id: 'img-2', url: 'https://cdn/b.jpg', publicId: 'p-b', altText: null, orderIndex: 1 },
  ],
  itineraryDays: [],
};

describe('ItineraryGenerationContainer — edit-save image payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiService.getPackageStats.mockResolvedValue({ success: true, data: { total: 1, active: 1, featured: 0, avgRating: 0 } });
    mockApiService.getPackages.mockResolvedValue({ success: true, data: [persistedPackage] });
    mockApiService.getPackagesProtected.mockResolvedValue({ success: true, data: [persistedPackage] });
    mockApiService.getPackage.mockResolvedValue({ success: true, data: persistedPackage });
    mockApiService.updatePackage.mockResolvedValue({ success: true, data: persistedPackage });
  });

  it('includes every DB-loaded image (no public_id) in the update payload, not just newly uploaded ones', async () => {
    render(
      <MemoryRouter>
        <ItineraryGenerationContainer />
      </MemoryRouter>,
    );

    const editButton = await screen.findByRole('button', { name: /^Edit$/i });
    await userEvent.click(editButton);

    const saveButton = await screen.findByRole('button', { name: 'Stub Save' });
    await userEvent.click(saveButton);

    await waitFor(() => expect(mockApiService.updatePackage).toHaveBeenCalled());

    const [calledPackageId, payload] = mockApiService.updatePackage.mock.calls[0];
    expect(calledPackageId).toBe('pkg-1');
    expect(payload.images).toEqual([
      { url: 'https://cdn/a.jpg', publicId: 'p-a', altText: null },
      { url: 'https://cdn/b.jpg', publicId: 'p-b', altText: null },
    ]);
  });
});

describe('ItineraryGenerationContainer — recommendation deep links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiService.getPackageStats.mockResolvedValue({ success: true, data: { total: 1, active: 1, featured: 0, avgRating: 0 } });
    mockApiService.getPackages.mockResolvedValue({ success: true, data: [persistedPackage] });
    mockApiService.getPackagesProtected.mockResolvedValue({ success: true, data: [persistedPackage] });
  });

  it('requests only linked package IDs and replaces unrelated status tabs with the active filter', async () => {
    render(
      <MemoryRouter initialEntries={['/packages?ids=pkg-1&focus=recommendation']}>
        <ItineraryGenerationContainer />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockApiService.getPackages).toHaveBeenCalledWith(expect.objectContaining({
      ids: 'pkg-1',
      page: 1,
    })));
    expect(await screen.findByText(/Active filter: linked packages/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /All Packages/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
  });
});
