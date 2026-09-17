export const concertsPopularity = () => `app:concerts:popularity`;
export const redisOnlyFavoritesKey = (userId: string) => `app:redis-only:favorites:${userId}`;
export const redisOnlyConcertsPopularity = () => `app:redis-only:concerts:popularity`;
export const seatReservationKey = (concertId: string, seatId: string) =>
  `app:concert:${encodeURIComponent(concertId)}:seat:${encodeURIComponent(seatId)}:reservation`;
