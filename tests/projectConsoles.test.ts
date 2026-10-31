import { expect, it } from "vitest";
import { selectProjectConsoles } from "../src/client/projectConsoles.js";

const consoles = Array.from({ length: 13 }, (_, index) => ({
  name: `slot-${index}`, command: `ycodex resume thread-${index}`, cwd: "D:\\work",
  lastStartedAt: index < 12 ? new Date(Date.UTC(2026, 9, 19, index)).toISOString() : undefined
}));

it("shows the last nine launches and searches all slots, including never started ones", () => {
  expect(selectProjectConsoles(consoles, "", false).map((item) => item.name)).toEqual([
    "slot-11", "slot-10", "slot-9", "slot-8", "slot-7", "slot-6", "slot-5", "slot-4", "slot-3"
  ]);
  expect(selectProjectConsoles(consoles, " SLOT-12 ", false)).toEqual([consoles[12]]);
  expect(selectProjectConsoles(consoles, "thread-12", false)).toEqual([consoles[12]]);
  expect(selectProjectConsoles(consoles, "", true)).toEqual(consoles);
  expect(selectProjectConsoles(consoles.slice(0, 10), "", false)).toEqual(consoles.slice(0, 10));
});

it("returns to the same compact recent list after expanding all slots", () => {
  const originalOrder = consoles.map((item) => item.name);
  const compact = selectProjectConsoles(consoles, "", false);
  expect(selectProjectConsoles(consoles, "", true)).toHaveLength(13);
  expect(selectProjectConsoles(consoles, "", false)).toEqual(compact);
  expect(selectProjectConsoles(consoles, "", false)).toHaveLength(9);
  expect(consoles.map((item) => item.name)).toEqual(originalOrder);
});
