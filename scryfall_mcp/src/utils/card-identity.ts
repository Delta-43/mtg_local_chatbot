type CardIdentity = {
  id?: string;
  oracle_id?: string;
  name?: string;
};

export function isSameLogicalCard(left: CardIdentity, right: CardIdentity): boolean {
  if (left.id && right.id && left.id === right.id) {
    return true;
  }

  if (left.oracle_id && right.oracle_id) {
    return left.oracle_id === right.oracle_id;
  }

  return Boolean(
    left.name &&
    right.name &&
    left.name.trim().toLowerCase() === right.name.trim().toLowerCase()
  );
}

export function excludeLogicalCardFromQuery(query: string, card: CardIdentity): string {
  if (card.oracle_id) {
    return `${query.trim()} -oracleid:${card.oracle_id}`.trim();
  }

  const name = card.name?.trim();
  if (!name) {
    return query.trim();
  }

  return `${query.trim()} -!${JSON.stringify(name)}`.trim();
}
