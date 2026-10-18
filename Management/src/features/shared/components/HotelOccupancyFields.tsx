import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface HotelRoomOccupancy {
  adults: number;
  childAges: (number | null)[];
}

interface HotelOccupancyFieldsProps {
  occupancies: HotelRoomOccupancy[];
  onChange: (occupancies: HotelRoomOccupancy[]) => void;
  maxRooms?: number;
}

interface CountControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function CountControl({ label, value, min, max, onChange }: CountControlProps) {
  return (
    <div>
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <div className="flex h-9 items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={value <= min} aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - 1))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <output className="min-w-5 text-center text-sm font-medium tabular-nums text-foreground">{value}</output>
        <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={value >= max} aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + 1))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function HotelOccupancyFields({
  occupancies,
  onChange,
  maxRooms = 4,
}: HotelOccupancyFieldsProps) {
  const updateRoom = (roomIndex: number, room: HotelRoomOccupancy) => {
    onChange(occupancies.map((current, index) => index === roomIndex ? room : current));
  };

  const setChildCount = (roomIndex: number, childCount: number) => {
    const current = occupancies[roomIndex];
    updateRoom(roomIndex, {
      ...current,
      childAges: Array.from({ length: childCount }, (_, index) => current.childAges[index] ?? null),
    });
  };

  return (
    <section className="space-y-3" aria-label="Room guests">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">Rooms and guests</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={occupancies.length >= maxRooms}
          onClick={() => onChange([...occupancies, { adults: 1, childAges: [] }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add room
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        {occupancies.map((room, roomIndex) => (
        <fieldset key={roomIndex} className="min-w-0 flex-1 basis-[280px] rounded-md border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <legend className="px-1 text-xs font-semibold text-foreground">Room {roomIndex + 1}</legend>
            {occupancies.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label={`Remove room ${roomIndex + 1}`}
                title={`Remove room ${roomIndex + 1}`}
                onClick={() => onChange(occupancies.filter((_, index) => index !== roomIndex))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <CountControl label="Adults" value={room.adults} min={1} max={9}
              onChange={(adults) => updateRoom(roomIndex, { ...room, adults })} />
            <CountControl label="Children" value={room.childAges.length} min={0} max={9}
              onChange={(count) => setChildCount(roomIndex, count)} />
          </div>
          {room.childAges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
            {room.childAges.map((age, childIndex) => (
              <label key={childIndex} className="block w-24 text-xs text-muted-foreground">
                Child {childIndex + 1} age
                <select
                  value={age ?? ''}
                  onChange={(event) => updateRoom(roomIndex, {
                    ...room,
                    childAges: room.childAges.map((currentAge, index) => index === childIndex ? Number(event.target.value) : currentAge),
                  })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                >
                  <option value="" disabled>Age</option>
                  {Array.from({ length: 18 }, (_, childAge) => (
                    <option key={childAge} value={childAge}>{childAge}</option>
                  ))}
                </select>
              </label>
            ))}
            </div>
          )}
        </fieldset>
        ))}
      </div>
    </section>
  );
}