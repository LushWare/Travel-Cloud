import { useCallback, useState } from 'react';

export function useAnnouncer(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => setMessage(next), []);
  return [message, announce];
}

export function LiveStatus({ message }: { message: string }) {
  return <p role="status" aria-live="polite" className="sr-only">{message}</p>;
}