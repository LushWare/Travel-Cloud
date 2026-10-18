/**
 * ItineraryGeneration Container Component
 * Sidebar navigation layout for package management
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import {
  Package, Plus, Sparkles, MapPin,
  Calendar, Eye, Edit, Download, Copy, Trash2,
  Image as ImageIcon, Grid, List, LayoutGrid
} from 'lucide-react';

// Hooks
import { usePackageState, useItineraryForm, useImageUpload } from '../hooks';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermission } from '../../../contexts/PermissionContext';

// Components
import {
  PackageDetailsModal,
  NewEditPackageForm,
  PackagePDFPreviewDialog,
  AIPackageDialog,
  PackageCard,
  PackageStats,
  PackageFilters,
} from '../components';
import Pagination from '../../user-management/components/Common/Pagination';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Services
import { uploadPackageImages } from '../../../services/cloudinaryService';
import ApiService from '../services/apiService';

// Utils
import {
  filterPackages,
} from '../utils/helpers';
import { VALIDATION_MESSAGES } from '../utils/constants';
import { createDefaultPackage } from '../types';

// Sample data
import { SAMPLE_PACKAGES } from './sampleData';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import PageHeader from '../../../components/PageHeader';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

const ItineraryGenerationContainer = () => {
  const [, navigate] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedPackageIds = searchParams.get('ids');
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [showNewPackageDialog, setShowNewPackageDialog] = useState(false);
  const [showEditPackageDialog, setShowEditPackageDialog] = useState(false);
  const [editPackageData, setEditPackageData] = useState<any>(null);
  const [showAIPackageDialog, setShowAIPackageDialog] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState<{ isOpen: boolean; blob: Blob | null; fileName: string; packageData: any }>({
    isOpen: false,
    blob: null,
    fileName: '',
    packageData: null,
  });
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<{ pages: number; total: number } | null>(null);
  const [isLoadingPackages, setIsLoadingPackages] = useState(true);
  const [itemsPerPage] = useState(12);

  // Stats state
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    featured: 0,
    avgRating: 0,
  });

  const isSalesRep = user?.role === 'salesRep';
  const canEditPackages =
    user?.role === 'superAdmin' ||
    (user?.role === 'admin' && hasPermission('manage_packages')) ||
    (user?.role === 'salesRep' && hasPermission('manage_packages'));

  // Use custom hooks
  const { packages, setPackages, updatePackage, deletePackage } = usePackageState(SAMPLE_PACKAGES);
  // Was previously passed as the first arg (packageId: string|null), not the second
  // (initialData) - only ever type-checked because of an `as any` cast, which is what
  // surfaced this. formData/newFormData initialized to a generic empty shape instead
  // of the real defaults until the first setNewFormData(createDefaultPackage()) call
  // overwrote it - fixed at the source rather than left masked.
  const { formData: newFormData, setFormData: setNewFormData } = useItineraryForm(null, createDefaultPackage());
  const { images, setImages, handleUpload: handleImageUploadHook, removeImage, deletingIndexes } = useImageUpload();

  useEffect(() => {
    if (!linkedPackageIds) return;
    setSearchTerm('');
    setStatusFilter(null);
    setCurrentPage(1);
  }, [linkedPackageIds]);

  // Filter packages
  const filteredPackages = filterPackages(packages, searchTerm);

  // Status filter tabs
  const statusTabs = [
    { id: null, label: 'All Packages', count: stats.total },
    { id: 'active', label: 'Active', count: stats.active },
    { id: 'drafts', label: 'Drafts', count: Math.max(0, stats.total - stats.active) },
  ];

  /**
   * Load package stats from API
   */
  useEffect(() => {
    const loadStats = async () => {
      try {
        const response = await ApiService.getPackageStats();
        if (response.success && response.data) {
          setStats(response.data);
        }
      } catch (error) {
        console.error('Error loading package stats:', error);
      }
    };
    loadStats();
  }, [packages]);

  /**
   * Load packages from API
   */
  useEffect(() => {
    const loadPackages = async (page = 1) => {
      setIsLoadingPackages(true);
      try {
        const params: Record<string, any> = { page, limit: itemsPerPage };
        if (linkedPackageIds) {
          params.ids = linkedPackageIds;
        } else {
          if (statusFilter === null) params.draftsLast = true;
          if (statusFilter === 'active') params.isActive = true;
          if (statusFilter === 'drafts') params.isActive = false;
        }

        const response = await ApiService.getPackagesProtected(params);

        if (response.success && Array.isArray(response.data)) {
          setPackages(response.data);
          const total = Number(response.pagination?.total ?? response.total ?? response.count ?? response.data.length);
          const pages = Number(response.pagination?.totalPages ?? response.pagination?.pages) || Math.max(1, Math.ceil(total / itemsPerPage));
          setPagination({ pages, total });
        }
      } catch (error) {
        console.error('Error loading packages:', error);
      } finally {
        setIsLoadingPackages(false);
      }
    };

    loadPackages(linkedPackageIds ? 1 : currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesRep, currentPage, itemsPerPage, statusFilter, linkedPackageIds]);

  useEffect(() => {
    if (!linkedPackageIds || !recommendationFocus || isLoadingPackages) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkedPackageIds, recommendationFocus, isLoadingPackages, packages]);

  // Handlers
  const handleNewPackageDialogOpen = () => {
    if (isSalesRep && !hasPermission('manage_packages')) {
      Swal.fire('Access Denied', 'Sales Representatives do not have permission to create packages.', 'info');
      return;
    }
    setNewFormData(createDefaultPackage());
    setImages([]);
    setShowNewPackageDialog(true);
  };

  const handleAIPackageDialogOpen = () => {
    // Intentionally still blocked for ALL salesRep regardless of manage_packages —
    // backend /packages/generate-ai remains admin/staff-only (package.routes.js).
    if (isSalesRep) {
      Swal.fire('Access Denied', 'Sales Representatives do not have permission to create packages.', 'info');
      return;
    }
    setShowAIPackageDialog(true);
  };

  const handleAIPackageGenerated = (generatedPackageData: any) => {
    // /generate-ai already persists the package + itinerary in one shot, so this must
    // flow into the edit path (PUT, same id) rather than the new-package create path —
    // routing it through "New Package" would create a second, itinerary-less duplicate.
    setPackages((prev: any[]) => [generatedPackageData, ...prev]);

    const days = generatedPackageData.days || generatedPackageData.itinerary?.days || [];
    const formattedImages = (generatedPackageData.images || []).map((img: any) => {
      if (typeof img === 'object' && img.url) return img;
      if (typeof img === 'string') {
        return { url: img, public_id: img.split('/').pop()?.split('.')[0] || 'unknown' };
      }
      return img;
    });

    setEditPackageData({ ...generatedPackageData, days: [...days], images: [...formattedImages] });
    setImages(formattedImages);
    setShowAIPackageDialog(false);
    setShowEditPackageDialog(true);
  };

  const handleViewPackage = async (pkg: any) => {
    try {
      const packageId = pkg._id || pkg.id;
      const response = await ApiService.getPackage(packageId);
      if (response.success && response.data) {
        setSelectedPackage(response.data);
      } else {
        setSelectedPackage(pkg);
      }
    } catch (error) {
      console.error('Error fetching package details:', error);
      setSelectedPackage(pkg);
    }
  };

  const handleEditPackage = async (pkg: any) => {
    if (isSalesRep && !hasPermission('manage_packages')) {
      Swal.fire('Access Denied', 'Sales Representatives do not have permission to edit packages.', 'info');
      return;
    }

    try {
      const packageId = pkg._id || pkg.id;
      const response = await ApiService.getPackage(packageId);

      if (!response.success || !response.data) {
        throw new Error('Failed to fetch package details');
      }

      const fullPackage = response.data;

      // Map API relational itineraryDays → editor-friendly days
      const days = (fullPackage.itineraryDays || []).map((apiDay: any) => ({
        dayNumber: apiDay.dayNumber,
        title: apiDay.title || '',
        description: apiDay.description || '',
        meals: {
          breakfast: apiDay.breakfastCount > 0,
          lunch: apiDay.lunchCount > 0,
          dinner: apiDay.dinnerCount > 0,
        },
        breakfastCount: apiDay.breakfastCount ?? 0,
        lunchCount: apiDay.lunchCount ?? 0,
        dinnerCount: apiDay.dinnerCount ?? 0,
        mealPriceOverride: apiDay.mealPriceOverride,
        locations: (apiDay.places || []).map((p: any) => p.place?.name || p.customName).filter(Boolean),
        activities: (apiDay.activities || []).map((a: any) => a.activity?.name || '').filter(Boolean),
        places: (apiDay.places || []).map((p: any) => ({
          name: p.place?.name || p.customName || '',
          placeId: p.placeId,
        })),
        flights: apiDay.flights || [],
        accommodation: apiDay.accommodation && Object.keys(apiDay.accommodation).length > 0 ? apiDay.accommodation : null,
        _relational: {
          places: apiDay.places || [],
          activities: apiDay.activities || [],
          transports: apiDay.transports || [],
        },
        images: apiDay.images || [],
        notes: '',
      }));

      const formattedImages = (fullPackage.images || []).map((img: any) => {
        if (typeof img === 'object' && img.url) return img;
        if (typeof img === 'string') {
          return { url: img, public_id: img.split('/').pop()?.split('.')[0] || 'unknown' };
        }
        return img;
      });

      const editData = { ...fullPackage, days: [...days], images: [...formattedImages] };
      setEditPackageData(editData);
      setShowEditPackageDialog(true);
      setImages(formattedImages);
    } catch (error) {
      console.error('Failed to fetch package for editing:', error);
      Swal.fire('Error', 'Failed to load package details for editing. Please try again.', 'error');
    }
  };

  const handleSaveNewPackage = async (formData: any) => {
    try {
      if (isUploadingImages) {
        Swal.fire('Please Wait', 'Images are still uploading. Please wait...', 'info');
        return;
      }

      const validationErrors = [];

      if (formData.name && formData.name.trim().length > 100) validationErrors.push('Package Name must not exceed 100 characters');
      if (formData.destination && formData.destination.trim().length > 100) validationErrors.push('Destination must not exceed 100 characters');
      if (formData.description && formData.description.trim().length > 2000) validationErrors.push('Description must not exceed 2000 characters');
      if (formData.price && parseFloat(formData.price) < 0) validationErrors.push('Price must be a non-negative number');
      if (formData.duration && parseInt(formData.duration, 10) < 0) validationErrors.push('Duration must be a non-negative number');

      if (validationErrors.length > 0) {
        Swal.fire('Validation Errors', `Please fix the following errors:\n${validationErrors.map(f => `• ${f}`).join('\n')}`, 'error');
        return;
      }

      const cleanDays = (formData.days || []).filter((day: any) => day && (day.title || day.dayNumber)).map((day: any) => {
        const cleanDay = { ...day };
        if (!cleanDay.dayNumber && cleanDay.title) {
          const dayMatch = cleanDay.title.match(/day\s*(\d+)/i);
          cleanDay.dayNumber = dayMatch ? parseInt(dayMatch[1], 10) : 1;
        }
        if (!cleanDay.title && cleanDay.dayNumber) cleanDay.title = `Day ${cleanDay.dayNumber}`;
        if (cleanDay.description === undefined || cleanDay.description === null) cleanDay.description = '';
        if (cleanDay.accommodation) {
          if (!cleanDay.accommodation.type || cleanDay.accommodation.type === '') delete cleanDay.accommodation.type;
          const hasValidData = Object.values(cleanDay.accommodation).some((v) => v && v !== '');
          if (!hasValidData) delete cleanDay.accommodation;
        }
        return cleanDay;
      });

      const sanitizedData: any = {
        ...formData,
        category: formData.category || 'FAMILY',
        basePrice: formData.basePrice ?? formData.price ?? 0,
        durationDays: formData.durationDays || formData.duration || 1,
        days: cleanDays,
        images: images
          .filter((img: any) => !img.isTemp && img.url)
          .map((img: any) => ({ url: img.url, publicId: img.publicId || img.public_id, altText: img.altText })),
      };

      delete sanitizedData._id;
      delete sanitizedData.id;
      delete sanitizedData._v;
      delete sanitizedData.__v;

      const response = await ApiService.createPackage(sanitizedData);

      if (response.success) {
        setPackages((prev: any[]) => [response.data, ...prev]);
        setShowNewPackageDialog(false);
        setNewFormData(createDefaultPackage());
        setImages([]);
        setCurrentPage(1);
        Swal.fire('Success', VALIDATION_MESSAGES.PACKAGE_CREATED, 'success');
      } else {
        Swal.fire('Error', response.message || 'Failed to create package', 'error');
      }
    } catch (error: any) {
      console.error('Error creating package:', error);
      if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
        const errorList = error.errors.map((err: any) => `• ${err.param || err.field}: ${err.msg}`).join('\n');
        Swal.fire('Validation Error', `Please fix the following:\n\n${errorList}`, 'error');
      } else {
        Swal.fire('Error', apiErrorMessage(error), 'error');
      }
    }
  };

  const handleSaveEditPackage = async (formData: any) => {
    try {
      if (isUploadingImages) {
        Swal.fire('Please Wait', 'Images are still uploading. Please wait...', 'info');
        return;
      }

      const validationErrors = [];

      if (formData.name && formData.name.trim().length > 100) validationErrors.push('Package Name must not exceed 100 characters');
      if (formData.destination && formData.destination.trim().length > 100) validationErrors.push('Destination must not exceed 100 characters');
      if (formData.description && formData.description.trim().length > 2000) validationErrors.push('Description must not exceed 2000 characters');
      if (formData.price && parseFloat(formData.price) < 0) validationErrors.push('Price must be a non-negative number');
      if (formData.duration && parseInt(formData.duration, 10) < 0) validationErrors.push('Duration must be a non-negative number');

      if (validationErrors.length > 0) {
        Swal.fire('Validation Errors', `Please fix the following errors:\n${validationErrors.map(f => `• ${f}`).join('\n')}`, 'error');
        return;
      }

      if (!formData._id && !formData.id) {
        Swal.fire('Error', 'Package ID is missing', 'error');
        return;
      }

      const packageId = formData._id || formData.id;

      const cleanDays = (formData.days || []).filter((day: any) => day && (day.title || day.dayNumber)).map((day: any) => {
        const cleanDay = { ...day };
        if (!cleanDay.dayNumber && cleanDay.title) {
          const dayMatch = cleanDay.title.match(/day\s*(\d+)/i);
          cleanDay.dayNumber = dayMatch ? parseInt(dayMatch[1], 10) : 1;
        }
        if (!cleanDay.title && cleanDay.dayNumber) cleanDay.title = `Day ${cleanDay.dayNumber}`;
        if (cleanDay.description === undefined || cleanDay.description === null) cleanDay.description = '';
        if (cleanDay.accommodation) {
          if (!cleanDay.accommodation.type || cleanDay.accommodation.type === '') delete cleanDay.accommodation.type;
          const hasValidData = Object.values(cleanDay.accommodation).some((v) => v && v !== '');
          if (!hasValidData) delete cleanDay.accommodation;
        }
        return cleanDay;
      });

      const sanitizedData: any = {
        ...formData,
        category: formData.category || 'FAMILY',
        basePrice: formData.basePrice ?? formData.price ?? 0,
        durationDays: formData.durationDays || formData.duration || 1,
        days: cleanDays,
        images: images
          .filter((img: any) => !img.isTemp && img.url)
          .map((img: any) => ({ url: img.url, publicId: img.publicId || img.public_id, altText: img.altText })),
      };

      delete sanitizedData._id;
      delete sanitizedData._v;
      delete sanitizedData.__v;
      delete sanitizedData.createdAt;
      delete sanitizedData.createdBy;
      delete sanitizedData.slug;

      const response = await ApiService.updatePackage(packageId, sanitizedData);

      if (response.success) {
        updatePackage(packageId, response.data);
        setShowEditPackageDialog(false);
        setEditPackageData(null);
        Swal.fire('Success', VALIDATION_MESSAGES.PACKAGE_UPDATED, 'success');
      } else {
        Swal.fire('Error', response.message || 'Failed to update package', 'error');
      }
    } catch (error) {
      console.error('Error updating package:', error);
      Swal.fire('Error', (error as Error).message || 'Failed to update package', 'error');
    }
  };

  const handleDownloadPackage = async (pkg: any) => {
    try {
      const packageId = pkg._id || pkg.id;
      setPdfPreviewData({ isOpen: true, blob: null, fileName: '', packageData: pkg });
      setIsGeneratingPdf(true);

      // Server-generated (Services/package-service) rather than built client-side —
      // matches how quotation PDFs are already produced by billing-service.
      const blob = await ApiService.getPackagePdfBlob(packageId);
      const fileName = `${(pkg.title || pkg.name || 'Package').replace(/[^a-z0-9]/gi, '_')}_Itinerary.pdf`;
      setPdfPreviewData({ isOpen: true, blob, fileName, packageData: pkg });
    } catch (error) {
      console.error('Error generating package PDF:', error);
      setPdfPreviewData({ isOpen: false, blob: null, fileName: '', packageData: null });
      Swal.fire('Error', 'Failed to generate PDF preview. Please try again.', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDeletePackage = (id: string) => {
    const pkg = packages.find((p: any) => p._id === id || p.id === id);
    if (!pkg) return;

    Swal.fire({
      title: `Delete ${pkg.title}?`,
      text: 'This will permanently remove the package.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete it',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#e3342f',
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const packageId = pkg._id || pkg.id;
          const response = await ApiService.deletePackage(packageId);

          if (response.success) {
            deletePackage(packageId);
            if (selectedPackage?._id === packageId || selectedPackage?.id === packageId) {
              setSelectedPackage(null);
            }
            Swal.fire('Deleted', `${pkg.title} ${VALIDATION_MESSAGES.PACKAGE_DELETED}`, 'success');
          } else {
            Swal.fire('Error', response.message || 'Failed to delete package', 'error');
          }
        } catch (error) {
          console.error('Error deleting package:', error);
          Swal.fire('Error', (error as Error).message || 'Failed to delete package', 'error');
        }
      }
    });
  };

  const handleDuplicatePackage = (pkg: any) => {
    if (isSalesRep && !hasPermission('manage_packages')) {
      Swal.fire('Access Denied', 'Sales Representatives do not have permission to duplicate packages.', 'info');
      return;
    }

    Swal.fire({
      title: `Duplicate ${pkg.title}?`,
      text: 'This will create a copy of the package.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, duplicate it',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#3b82f6',
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const duplicateData: any = { ...pkg, title: `${pkg.title} (Copy)`, isActive: false, bookings: 0, rating: 0, numReviews: 0 };
          delete duplicateData._id;

          const response = await ApiService.createPackage(duplicateData);

          if (response.success) {
            setPackages((prev: any[]) => [response.data, ...prev]);
            setCurrentPage(1);
            Swal.fire('Success', `${pkg.title} has been duplicated successfully.`, 'success');
          } else {
            Swal.fire('Error', response.message || 'Failed to duplicate package', 'error');
          }
        } catch (error) {
          console.error('Error duplicating package:', error);
          Swal.fire('Error', (error as Error).message || 'Failed to duplicate package', 'error');
        }
      }
    });
  };

  const handleImageUpload = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setIsUploadingImages(true);

    const tempImages = fileArray.map(file => ({
      url: URL.createObjectURL(file),
      public_id: 'temp-' + Date.now() + '-' + Math.random(),
      isTemp: true,
    }));
    setImages((prev) => [...prev, ...tempImages]);

    try {
      const uploadedImages = await uploadPackageImages(files, (progress: { current: number; total: number }) => {
        console.log(`Upload progress: ${progress.current}/${progress.total}`);
      });

      setImages((prev) => {
        const withoutTemp = prev.filter((img: any) => !img.isTemp);
        return [...withoutTemp, ...uploadedImages];
      });

      tempImages.forEach(img => URL.revokeObjectURL(img.url));
      Swal.fire('Success', `${uploadedImages.length} image(s) uploaded successfully!`, 'success');
    } catch (error: any) {
      console.error('Upload error:', error);
      setImages((prev) => prev.filter((img: any) => !img.isTemp));
      tempImages.forEach(img => URL.revokeObjectURL(img.url));

      let errorMessage = 'Failed to upload images';
      if (error.message.includes('500')) {
        errorMessage = 'Server error occurred. Please check if the server is running.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      Swal.fire('Error', errorMessage, 'error');
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleImageRemove = (index: number) => {
    const packageId = showEditPackageDialog ? (editPackageData?.id || editPackageData?._id) : null;
    removeImage(index, { packageId });
  };

  const handleSetCover = async (imageId: string) => {
    const packageId = editPackageData?.id || editPackageData?._id;
    if (!packageId) return;

    try {
      const response = await ApiService.setPackageCover(packageId, imageId);
      if (response.success) {
        setEditPackageData((prev: any) => (prev ? { ...prev, coverImage: response.data.coverImage } : prev));
        setPackages((prev: any[]) => prev.map((p) => (p.id === packageId ? { ...p, coverImage: response.data.coverImage } : p)));
      }
    } catch (error) {
      console.error('Failed to set cover image:', error);
      Swal.fire('Error', (error as Error).message || 'Failed to set cover image', 'error');
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStatusFilterChange = (status: string | null) => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title={linkedPackageIds ? 'Linked Packages' : statusFilter ? `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Packages` : 'All Packages'}
        subtitle={`${searchTerm ? filteredPackages.length : pagination?.total ?? filteredPackages.length} packages found`}
        actions={
          <>
            <Tabs value={viewMode} onValueChange={(value) => value && setViewMode(value as 'grid' | 'list')}>
              <TabsList>
                <TabsTrigger value="grid" aria-label="Grid view">
                  <LayoutGrid className="w-4 h-4" />
                </TabsTrigger>
                <TabsTrigger value="list" aria-label="List view">
                  <List className="w-4 h-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {!isSalesRep && (
              <Button onClick={handleAIPackageDialogOpen} variant="outline">
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">AI Generate</span>
              </Button>
            )}
            {(!isSalesRep || canEditPackages) && (
              <Button onClick={handleNewPackageDialogOpen}>
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New Package</span>
              </Button>
            )}
          </>
        }
      />

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {!linkedPackageIds && <PackageStats stats={stats} />}
        <RecommendationStrip module="packages" />

        <div id="recommendation-target" className="scroll-mt-20 space-y-4 sm:space-y-6">
          <PackageFilters
            searchTerm={searchTerm}
            onSearchChange={handleSearchChange}
            statusFilter={statusFilter}
            onStatusFilterChange={handleStatusFilterChange}
            statusTabs={statusTabs}
            linkedPackageCount={linkedPackageIds ? (pagination?.total ?? filteredPackages.length) : undefined}
            onClearLinkedFilter={() => setSearchParams({})}
          />

          {filteredPackages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg font-medium text-foreground">No packages found</p>
              <p className="text-sm">Create your first package to get started</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6' : 'space-y-4'}>
              {filteredPackages.map((pkg: any) => (
                <PackageCard
                  key={pkg._id || pkg.id}
                  pkg={pkg}
                  onView={handleViewPackage}
                  onEdit={handleEditPackage}
                  onDownload={handleDownloadPackage}
                  onDelete={handleDeletePackage}
                  onDuplicate={handleDuplicatePackage}
                />
              ))}
            </div>
          )}

          {pagination && pagination.pages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={pagination.pages}
              onPageChange={handlePageChange}
              itemsPerPage={itemsPerPage}
              totalItems={pagination.total}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <PackageDetailsModal pkg={selectedPackage} onClose={() => setSelectedPackage(null)} />

      <NewEditPackageForm
        isOpen={showNewPackageDialog}
        title="Create New Travel Package"
        subtitle="Build a new itinerary with destinations, activities, and pricing"
        onClose={() => setShowNewPackageDialog(false)}
        formData={newFormData}
        setFormData={setNewFormData}
        onSave={(updatedData: any) => handleSaveNewPackage(updatedData || newFormData)}
        onImageUpload={handleImageUpload}
        onImageRemove={handleImageRemove}
        images={images}
        isUploadingImages={isUploadingImages}
        deletingImageIndexes={deletingIndexes}
      />

      {editPackageData && (
        <NewEditPackageForm
          isOpen={showEditPackageDialog}
          title="Edit Travel Package"
          subtitle="Update package details and itinerary"
          onClose={() => setShowEditPackageDialog(false)}
          formData={editPackageData}
          setFormData={setEditPackageData}
          onSave={(updatedData: any) => handleSaveEditPackage(updatedData || editPackageData)}
          onImageUpload={handleImageUpload}
          onImageRemove={handleImageRemove}
          images={images}
          isUploadingImages={isUploadingImages}
          deletingImageIndexes={deletingIndexes}
          coverImage={editPackageData.coverImage}
          onSetCover={handleSetCover}
        />
      )}

      <AIPackageDialog
        isOpen={showAIPackageDialog}
        onClose={() => setShowAIPackageDialog(false)}
        onPackageGenerated={handleAIPackageGenerated}
      />

      <PackagePDFPreviewDialog
        isOpen={pdfPreviewData.isOpen}
        onClose={() => setPdfPreviewData({ isOpen: false, blob: null, fileName: '', packageData: null })}
        pdfBlob={pdfPreviewData.blob}
        fileName={pdfPreviewData.fileName}
        packageData={pdfPreviewData.packageData}
        isGenerating={!pdfPreviewData.blob && isGeneratingPdf}
      />
    </div>
  );
};

export default ItineraryGenerationContainer;
