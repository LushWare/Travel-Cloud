/**
 * Package Card Component
 * Displays package information in card format with action buttons
 */

import {
  Calendar,
  MapPin,
  Briefcase,
  Star,
  Users,
  Edit,
  Eye,
  Download,
  Trash2,
  Copy,
  Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePermission } from '../../../contexts/PermissionContext';
import { formatPriceINR } from '../utils/helpers';
import { formatRating } from '@/utils/number';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// Categorical (non-state) tags for package category - rotates chart-1..5,
// same pattern as career's per-position tag (DESIGN.md Badge section).
const categoryColorClasses = [
  'bg-chart-1/10 text-chart-1',
  'bg-chart-2/10 text-chart-2',
  'bg-chart-3/10 text-chart-3',
  'bg-chart-4/10 text-chart-4',
  'bg-chart-5/10 text-chart-5',
];
const CATEGORY_ORDER = ['HONEYMOON', 'COUPLE', 'FAMILY', 'GROUP', 'WILD_SAFARI'];
const getCategoryColor = (category?: string) => {
  const index = CATEGORY_ORDER.indexOf(category || '');
  return index >= 0 ? categoryColorClasses[index % categoryColorClasses.length] : 'bg-muted text-muted-foreground';
};

interface PackageCardProps {
  pkg: any;
  onView: (pkg: any) => void;
  onEdit: (pkg: any) => void;
  onDownload: (pkg: any) => void;
  onDelete: (id: string) => void;
  onDuplicate: (pkg: any) => void;
}

const PackageCard = ({
  pkg,
  onView,
  onEdit,
  onDownload,
  onDelete,
  onDuplicate,
}: PackageCardProps) => {
  const { user } = useAuth();
  const { hasPermission } = usePermission();

  // Guard: Return null if pkg is invalid
  if (!pkg || typeof pkg !== 'object') {
    return null;
  }

  const displayPrice = pkg.sellPrice ?? pkg.basePrice;
  const formattedPrice = displayPrice ? formatPriceINR(displayPrice) : null;
  // Derive status from isActive (no more draft/published enum)
  const statusLabel = pkg.isActive ? 'Published' : 'Draft';

  // Check if user can edit packages (superAdmin, or admin/salesRep with manage_packages)
  const canEditPackages =
    user?.role === 'superAdmin' ||
    (user?.role === 'admin' && hasPermission('manage_packages')) ||
    (user?.role === 'salesRep' && hasPermission('manage_packages'));

  return (
    <Card className="overflow-hidden hover:shadow-dropdown transition-shadow flex flex-col group py-0 gap-0">
      {/* Image Section */}
      <div
        className={`h-40 relative overflow-hidden flex items-center justify-center ${
          pkg.images && pkg.images.length > 0 ? 'bg-muted' : 'bg-secondary'
        }`}
        style={
          pkg.images && pkg.images.length > 0
            ? {
                // Handle both string URLs and image objects
                backgroundImage: `url(${typeof pkg.images[0] === 'string' ? pkg.images[0] : pkg.images[0].url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}
        }
      >
        {!(pkg.images && pkg.images.length > 0) && (
          <ImageIcon className="w-12 h-12 text-muted-foreground opacity-50" />
        )}
        <Badge
          className={`absolute top-3 right-3 border font-semibold shadow-dropdown ${pkg.isActive ? 'border-success bg-success text-success-foreground' : 'border-warning bg-warning text-warning-foreground'}`}
        >
          {statusLabel}
        </Badge>
      </div>

      {/* Content Section */}
      <div className="p-4 pb-2">
        <h3 className="text-lg font-bold text-foreground">{pkg.title}</h3>
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge className={getCategoryColor(pkg.category)}>
            {pkg.category}
          </Badge>
          <Badge className="bg-muted text-muted-foreground">
            {pkg.region}
          </Badge>
        </div>
      </div>

      {/* Details Section */}
      <div className="flex-1 px-4 space-y-3">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="w-4 h-4" />
            {pkg.durationDays || 'N/A'} days
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            {pkg.destination || 'N/A'}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Briefcase className="w-4 h-4" />
            {pkg.accommodation || 'N/A'}
          </div>
        </div>

        {/* Rating and Price */}
        <div className="flex justify-between items-center pt-3 border-t border-border">
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 fill-warning text-warning" />
            <span className="text-sm font-semibold text-foreground">{formatRating(pkg.rating)}</span>
            <span className="text-xs text-muted-foreground">({pkg.numReviews || 0})</span>
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-foreground">{formattedPrice || 'Contact us'}</div>
        </div>

        {/* Bookings */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t border-border">
          <Users className="w-4 h-4" />
          {pkg.bookings || 0} bookings
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-3 border-t border-border">
          <Button onClick={() => onView(pkg)} title="View package details" size="sm" className="flex-1">
            <Eye className="w-4 h-4" />
            View
          </Button>

          {/* Edit button - only visible to admins/staff with manage_packages permission or superAdmin */}
          {canEditPackages && (
            <Button onClick={() => onEdit(pkg)} title="Edit package" variant="outline" size="sm" className="flex-1">
              <Edit className="w-4 h-4" />
              Edit
            </Button>
          )}
        </div>

        <div className="flex gap-2 pt-2 pb-3">
          <Button onClick={() => onDownload(pkg)} title="Download PDF" variant="outline" size="sm" className="flex-1">
            <Download className="w-4 h-4" />
            PDF
          </Button>

          {/* Duplicate button - only visible to admins/staff with manage_packages permission or superAdmin */}
          {canEditPackages && (
            <Button onClick={() => onDuplicate(pkg)} title="Duplicate package" variant="outline" size="sm" className="flex-1">
              <Copy className="w-4 h-4" />
              Duplicate
            </Button>
          )}

          {/* Delete button - visible to superAdmin, or admin/salesRep with manage_packages permission */}
          {canEditPackages && (
            <Button onClick={() => onDelete(pkg._id || pkg.id)} title="Delete package" variant="destructive" size="sm" className="flex-1">
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

export default PackageCard;
