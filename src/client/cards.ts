export function unreadCards<T extends { hash: string; read?: boolean }>(cards: readonly T[], readCardHashes: readonly string[] = []): T[] {
  const read = new Set(readCardHashes);
  return cards.filter((card) => card.read !== true && !read.has(card.hash));
}
