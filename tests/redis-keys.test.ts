import { expect, test } from "bun:test";
import { seatReservationKey } from "../src/redis/keys";

test("reservation keys distinguish IDs containing delimiters", () => {
  const first = seatReservationKey("x:seat:y", "z");
  const second = seatReservationKey("x", "y:seat:z");

  expect(first).not.toBe(second);
  expect(first).toBe("app:concert:x%3Aseat%3Ay:seat:z:reservation");
  expect(second).toBe("app:concert:x:seat:y%3Aseat%3Az:reservation");
  expect(seatReservationKey("x:y", "z")).not.toBe(seatReservationKey("x%3Ay", "z"));
});

test("reservation keys keep the existing format for simple IDs", () => {
  expect(seatReservationKey("concert-01", "A1"))
    .toBe("app:concert:concert-01:seat:A1:reservation");
});
