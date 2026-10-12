// ponytail: substring AND-match over whitespace-separated terms; swap in fuzzy scoring when misspellings matter.
export function matchesQuery(query, fields) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.filter(Boolean).join('\n').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function tabMatches(tab, query) {
  return matchesQuery(query, [tab.title, tab.url]);
}
