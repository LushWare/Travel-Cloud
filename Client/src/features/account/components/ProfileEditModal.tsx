import type { ChangeEvent } from 'react';
import { Save, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Editable profile fields, mirroring the shape accepted by services/api/account's updateProfile. */
export type ProfileFormData = {
  name: string;
  email: string;
  phone: string;
};

/** Inline feedback banner state produced by the profile-save flow. */
export interface UpdateMessage {
  type: 'success' | 'error';
  text: string;
}

interface ProfileEditModalProps {
  formData: ProfileFormData;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  updateMessage: UpdateMessage | null;
}

export default function ProfileEditModal({
  formData,
  onChange,
  onSave,
  onCancel,
  isSaving,
  updateMessage,
}: ProfileEditModalProps) {
  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto rounded-3xl bg-white p-0 font-sans text-gray-900 shadow-modal ring-1 ring-gray-200 max-w-[calc(100%-2rem)] sm:max-h-none sm:overflow-visible sm:max-w-xl"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-gray-200 px-8 py-6 max-sm:px-5 max-sm:py-5 rounded-t-3xl">
          <div className="min-w-0">
            <DialogTitle className="font-serif text-2xl font-semibold leading-tight text-gray-900">
              Edit Profile
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              Update your personal details
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close edit profile dialog"
            className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X className="w-6 h-6 text-gray-500" />
          </DialogClose>
        </DialogHeader>

        <div className="px-8 py-6 max-sm:px-5">
          {updateMessage && (
            <div className={`mb-6 rounded-xl border p-4 text-sm ${updateMessage.type === 'success' ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {updateMessage.text}
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Full Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={onChange}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                placeholder="Enter your name"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Email Address</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={onChange}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                placeholder="Enter your email"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Phone Number</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={onChange}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10"
                placeholder="Enter your phone number"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-b-3xl border-t border-gray-200 bg-brand-50 px-8 py-6 sm:flex-row sm:gap-4 max-sm:px-5">
          <button
            onClick={onCancel}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-6 py-3 font-sans font-semibold text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-sans font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
