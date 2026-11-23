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

it("pins every live status above recent stopped slots, including runs without timestamps", () => {
  const items = consoles.map((item, index) => ({ ...item, status: index === 0 ? "starting" : index === 1 ? "running" : index === 12 ? "ready" : "exited" }));
  const before = items.map((item) => ({ ...item }));
  expect(selectProjectConsoles(items, "", false).map((item) => item.name)).toEqual([
    "slot-0", "slot-1", "slot-12", "slot-11", "slot-10", "slot-9", "slot-8", "slot-7", "slot-6"
  ]);
  expect(items).toEqual(before);
});

it("never caps live consoles at nine, even after returning to compact mode", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    name: `slot-${index}`, command: "cmd", cwd: "D:\\work", status: index < 3 ? "idle" : index < 18 ? "running" : "exited"
  }));
  const live = items.slice(3, 18);
  expect(selectProjectConsoles(items, "", false)).toEqual(live);
  expect(selectProjectConsoles(items, "", true)).toEqual([...live, ...items.slice(0, 3), ...items.slice(18)]);
  expect(selectProjectConsoles(items, "", false)).toHaveLength(15);
});

it("puts live consoles first in small lists, expanded lists and search results without breaking filtering", () => {
  const items = [
    { ...consoles[0], status: "idle" },
    { ...consoles[1], status: "running" },
    { ...consoles[2], status: "exited" },
    { ...consoles[3], status: "ready" }
  ];
  const ordered = [items[1], items[3], items[0], items[2]];
  expect(selectProjectConsoles(items, "", false)).toEqual(ordered);
  expect(selectProjectConsoles(items, "", true)).toEqual(ordered);
  expect(selectProjectConsoles(items, "slot-", false)).toEqual(ordered);
  expect(selectProjectConsoles(items, "thread-0", false)).toEqual([items[0]]);
});

it("returns a stopped console to recent history and immediately promotes a newly started slot", () => {
  const items = consoles.map((item) => ({ ...item, status: "exited" }));
  items[12].status = "running";
  expect(selectProjectConsoles(items, "", false)[0]).toBe(items[12]);
  items[12].status = "exited";
  items[0].status = "starting";
  const visible = selectProjectConsoles(items, "", false);
  expect(visible[0]).toBe(items[0]);
  expect(visible).not.toContain(items[12]);
  expect(selectProjectConsoles([], "", false)).toEqual([]);
});
