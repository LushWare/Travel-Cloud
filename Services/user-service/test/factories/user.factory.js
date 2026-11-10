let counter = 0;

export function buildUserRow(overrides = {}) {
  counter += 1;
  return {
    id: `a0000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    name: 'Test User',
    email: `test-user-${counter}@example.com`,
    phone: null,
    phoneCountry: 'US',
    phoneE164: null,
    password: '$2a$12$hashedplaceholder',
    role: 'customer',
    isSuperAdmin: false,
    permissions: [],
    avatarPublicId: null,
    avatarUrl: null,
    isActive: true,
    isEmailVerified: false,
    isTempPassword: false,
    mustChangePassword: false,
    canBeDeleted: true,
    passwordChangedAt: null,
    lastLogin: null,
    lastActivity: new Date().toISOString(),
    createdById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function buildVendorProfile(overrides = {}) {
  return {
    id: 'vp-0000000000000001',
    userId: overrides.userId || 'a0000000-0000-4000-8000-000000000001',
    businessName: 'Sunrise Hotels',
    serviceType: 'hotel',
    businessRegistrationNumber: null,
    taxIdentificationNumber: null,
    addressStreet: null,
    addressCity: null,
    addressState: null,
    addressZipCode: null,
    addressCountry: null,
    contactPersonName: null,
    contactPersonPhone: null,
    contactPersonEmail: null,
    contactPersonDesignation: null,
    bankAccountName: null,
    bankAccountNumber: null,
    bankName: null,
    bankBranchName: null,
    bankIfscCode: null,
    bankSwiftCode: null,
    rating: 0,
    totalBookings: 0,
    vendorStatus: 'pending_verification',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function authHeaders(overrides = {}) {
  return {
    'x-user-id': overrides.id || 'a0000000-0000-4000-8000-000000000099',
    'x-user-role': overrides.role || 'admin',
    'x-user-email': overrides.email || 'actor@test.com',
    'x-user-name': overrides.name || 'Test Actor',
    'x-user-permissions': JSON.stringify(overrides.permissions || []),
    'x-user-is-super-admin': String(overrides.isSuperAdmin ?? false),
    'x-tenant-id': overrides.tenantId || '00000000-0000-4000-8000-000000000001',
  };
}
