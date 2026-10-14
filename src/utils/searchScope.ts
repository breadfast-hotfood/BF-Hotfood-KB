import { Tab } from '../types';

/**
 * Returns the default field KEY to search in for a given tab,
 * or null meaning "All fields".
 * Defaults to "Complaint Type" if present in the tab's field order.
 */
export function defaultSearchScope(tab: Tab | null | undefined): string | null {
  if (!tab || tab.kind === 'table' || tab.view === 'table') {
    return null;
  }

  const fieldOrder = tab.kb?.fieldOrder;
  if (!fieldOrder || !Array.isArray(fieldOrder) || fieldOrder.length === 0) {
    return null;
  }

  // Look for a field whose key (or English header) matches "Complaint Type"
  const found = fieldOrder.find((f) => {
    if (!f || !f.key) return false;
    const header = f.key.split(/\r?\n/)[0].trim().toLowerCase();
    return header === 'complaint type' || f.key.toLowerCase().includes('complaint type');
  });

  if (found) {
    return found.key;
  }

  // Fallback: check primaryKey
  if (tab.kb?.primaryKey && tab.kb.primaryKey.toLowerCase().includes('complaint type')) {
    return tab.kb.primaryKey;
  }

  return null;
}
