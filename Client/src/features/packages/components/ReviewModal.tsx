import type { FormEvent } from 'react';
import { Star, X } from 'lucide-react';
import { useAssistantPageRegistration } from '../../assistant/capabilities/AssistantCapabilityProvider';
import { assistantFieldState, useAssistantWrittenFields } from '../../assistant/actions/useAssistantFormPrefill';
import { AssistantFilledBadge, assistantMarkedFieldClass } from '../../assistant/components/AssistantFieldMarker';

export interface ReviewFormData {
  name: string;
  email: string;
  rating: number;
  comment: string;
}

interface ReviewModalProps {
  open: boolean;
  reviewData: ReviewFormData;
  isSubmittingReview: boolean;
  setReviewData: (data: ReviewFormData) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export default function ReviewModal({
  open,
  reviewData,
  isSubmittingReview,
  setReviewData,
  onSubmit,
  onClose,
}: ReviewModalProps) {
  const { written, markWritten, clearWritten } = useAssistantWrittenFields();

  // Registered only while the modal is open: a form that is not on screen must
  // not be fillable, and this component stays mounted (rendering null) when it
  // closes.
  useAssistantPageRegistration(
    open
      ? {
          surface: 'review',
          revision: 'review',
          // `step` is a planner idea; a form has exactly one, so it reports 1.
          pageContext: { surface: 'review', revision: 'review', step: 1 },
          actions: ['prefill_form'],
          hostedInDialog: true,
          prefill: {
            form: 'review',
            fields: () => ({
              name: assistantFieldState(reviewData.name, written.has('name')),
              comment: assistantFieldState(reviewData.comment, written.has('comment')),
            }),
            write: (fields) => {
              setReviewData({
                ...reviewData,
                ...(typeof fields.name === 'string' ? { name: fields.name } : {}),
                ...(typeof fields.comment === 'string' ? { comment: fields.comment } : {}),
              });
              markWritten(Object.keys(fields));
            },
          },
        }
      : null,
  );

  return open ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-white/65 p-4 backdrop-blur-[2px]">
          <div role="dialog" aria-modal="true" aria-labelledby="review-modal-title" className="review-modal-mobile max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-brand-100 bg-white p-6 shadow-2xl sm:max-h-none sm:overflow-visible lg:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Traveler notes</p>
                <h3 id="review-modal-title" className="font-display text-2xl font-semibold text-brand-dark-900">Write a Review</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">Share a detail that could help someone plan this trip.</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close review form"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-brand-50 hover:text-brand-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Your Name</label>
                <input
                  type="text"
                  required
                  value={reviewData.name}
                  onChange={(e) => {
                    clearWritten('name');
                    setReviewData({ ...reviewData, name: e.target.value });
                  }}
                  className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-accent-500 focus:border-transparent outline-none form-input-mobile ${assistantMarkedFieldClass(
                    written.has('name'),
                  )}`}
                  placeholder="Enter your name"
                />
                {written.has('name') && (
                  <div className="mt-1">
                    <AssistantFilledBadge />
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-900">Rating</label>
                  <span className="text-sm text-gray-600">{reviewData.rating} out of 5</span>
                </div>
                <div className="flex gap-2 justify-center sm:justify-start">
                    {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewData({ ...reviewData, rating: star })}
                        aria-label={`Rate ${star} out of 5`}
                        aria-pressed={reviewData.rating === star}
                        className="rounded-md p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <Star
                        className={`w-7 h-7 lg:w-8 lg:h-8 ${
                          star <= reviewData.rating
                            ? 'text-yellow-400 fill-current'
                            : 'text-gray-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Your Review</label>
                <textarea
                  required
                  value={reviewData.comment}
                  onChange={(e) => {
                    clearWritten('comment');
                    setReviewData({ ...reviewData, comment: e.target.value });
                  }}
                  className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-accent-500 focus:border-transparent outline-none resize-none form-input-mobile ${assistantMarkedFieldClass(
                    written.has('comment'),
                  )}`}
                  rows={4}
                  placeholder="Share your experience..."
                />
                {written.has('comment') && (
                  <div className="mt-1">
                    <AssistantFilledBadge />
                  </div>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors button-padding-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="flex-1 rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 button-padding-sm"
                >
                  {isSubmittingReview ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
  ) : null;
}
