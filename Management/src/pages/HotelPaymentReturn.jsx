import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import HotelService from '@/services/hotel.service';

const HOTEL_PAYMENT_SESSION_KEY = 'liteapi-hotel-payment-session';

export default function HotelPaymentReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing');
  const [booking, setBooking] = useState(null);
  const [returnPath, setReturnPath] = useState('/hotels');
  const [reference, setReference] = useState('');
  const started = useRef(false);
  const prebookId = searchParams.get('pid');
  const transactionId = searchParams.get('tid');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let session;
    try {
      session = JSON.parse(sessionStorage.getItem(HOTEL_PAYMENT_SESSION_KEY) || 'null');
    } catch {
      session = null;
    }

    const payload = session?.paymentPayload;
    const isRecent = session?.createdAt && Date.now() - session.createdAt < 30 * 60 * 1000;
    const matchesSession = session?.prebookId === prebookId
      && session?.transactionId === transactionId
      && payload?.prebookId === prebookId
      && payload?.payment?.transactionId === transactionId;
    if (!isRecent || !matchesSession || !payload?.clientReference || !payload?.guests?.length || !payload?.contact?.email) {
      sessionStorage.removeItem(HOTEL_PAYMENT_SESSION_KEY);
      setStatus('error');
      return;
    }

    const safeReturnPath = typeof session.returnPath === 'string' && session.returnPath.startsWith('/') && !session.returnPath.startsWith('//')
      ? session.returnPath
      : '/hotels';
    setReturnPath(safeReturnPath);
    setReference(payload.clientReference || '');

    const completeBooking = async () => {
      try {
        const response = payload.leadId
          ? await HotelService.bookWithContext(payload)
          : await HotelService.book(payload);
        sessionStorage.removeItem(HOTEL_PAYMENT_SESSION_KEY);
        setBooking(response.data);
        setStatus('confirmed');
      } catch {
        sessionStorage.removeItem(HOTEL_PAYMENT_SESSION_KEY);
        setStatus('error');
      }
    };

    void completeBooking();
  }, [prebookId, transactionId]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4 py-10">
      <section className="w-full max-w-lg space-y-4 text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Finalizing your hotel booking</h1>
            <p className="text-sm text-muted-foreground">LiteAPI confirmed the payment step. We are now requesting the hotel reservation.</p>
          </>
        )}
        {status === 'confirmed' && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <h1 className="text-xl font-semibold text-foreground">Hotel booking confirmed</h1>
            <p className="text-sm text-muted-foreground">{booking?.hotelName || 'Your hotel'}{booking?.liteapiBookingId ? ` · Provider reference ${booking.liteapiBookingId}` : ''}</p>
            <Button onClick={() => navigate(returnPath)}>Return to CRM</Button>
          </>
        )}
        {status === 'error' && (
          <>
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Booking confirmation needs attention</h1>
            <p className="text-sm text-muted-foreground">We could not confirm the reservation after the payment step. Do not submit another booking until your travel administrator checks its status.</p>
            {reference && <p className="text-xs text-muted-foreground">Booking reference: {reference}</p>}
            <Button variant="outline" onClick={() => navigate(returnPath)}>Return to CRM</Button>
          </>
        )}
      </section>
    </main>
  );
}