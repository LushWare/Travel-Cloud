const FIELD_LABELS: Record<string, string> = {
  title: 'Package Name',
  destination: 'Destination',
  description: 'Description',
  durationDays: 'Duration',
  category: 'Category',
  basePrice: 'Price',
  currency: 'Currency',
  coverImage: 'Cover Image',
  images: 'Images',
  inclusions: 'Inclusions',
  exclusions: 'Exclusions',
  termsAndConditions: 'Terms & Conditions',
};

export function describeFieldError(field: string): string {
  const day = field.match(/^itineraryDays\.(\d+)\.(.+)$/);
  if (day) return `Day ${Number(day[1]) + 1} – ${day[2].split('.')[0]}`;
  const top = field.split('.')[0];
  return FIELD_LABELS[top] || top || 'Form';
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
