type RoomRateOption = {
  offerId?: string;
  totalAmount?: number;
  mappedRoomId?: string | number | null;
  roomType?: string;
  offerRates?: RoomRateOption[];
};

type RoomDetails = {
  roomId?: string | number;
  name?: string;
};

export function groupOffersByRoom<TOffer extends RoomRateOption, TRoom extends RoomDetails>(
  offers: TOffer[],
  rooms: TRoom[] = [],
): Array<{ room?: TRoom; roomType?: string; options: TOffer[] }> {
  const groups = new Map<string, { room?: TRoom; roomType?: string; options: TOffer[] }>();

  offers.forEach((offer, index) => {
    const rate = offer.offerRates?.[0] || offer;
    const room = rooms.find((item) => String(item.roomId) === String(rate.mappedRoomId))
      || rooms.find((item) => item.name?.toLocaleLowerCase() === rate.roomType?.toLocaleLowerCase());
    const key = rate.mappedRoomId != null
      ? `mapped:${rate.mappedRoomId}`
      : room?.roomId != null
        ? `room:${room.roomId}`
        : room?.name
          ? `name:${room.name.toLocaleLowerCase()}`
          : `offer:${offer.offerId || index}`;
    const group = groups.get(key);

    if (group) {
      group.options.push(offer);
    } else {
      groups.set(key, { room, roomType: rate.roomType, options: [offer] });
    }
  });

  return Array.from(groups.values(), (group) => ({
    ...group,
    options: group.options.sort((left, right) => (left.totalAmount || 0) - (right.totalAmount || 0)),
  }));
}