import { expect, it } from "vitest";
import { unreadCards } from "../src/client/cards.js";

const cards = [
  { hash: "error:old", category: "error", read: false },
  { hash: "warning:old", category: "warning", read: false },
  { hash: "info:old", category: "info", read: false }
];

it("removes acknowledged cards from the feed and every severity count", () => {
  expect(unreadCards(cards)).toHaveLength(3);
  expect(unreadCards(cards, cards.map((card) => card.hash))).toEqual([]);
  expect(unreadCards(cards.map((card) => ({ ...card, read: true })))).toEqual([]);
});

it("uses fresh record acknowledgements even when the card snapshot predates Mark read", () => {
  expect(unreadCards(cards, ["error:old"]).map((card) => card.category)).toEqual(["warning", "info"]);
});

it("supports older servers without a per-card read flag and shows new errors", () => {
  const oldServer = [{ hash: "error:old" }, { hash: "error:new" }];
  expect(unreadCards(oldServer, ["error:old"])).toEqual([{ hash: "error:new" }]);
});
