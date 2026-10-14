export interface AuthUser {
  uid: string;
  userId: string;
  name: string;
  email: string;
  role: 'User' | 'Admin' | 'Main Admin';
  enabled: boolean;
}

export type AuthStatus = 'loading' | 'unauthenticated' | 'unauthorized' | 'authorized';

export interface GridCell {
  v?: string;
  l?: string;
  rs?: number;
  cs?: number;
  cov?: [number, number];
}

export interface FieldOrder {
  key: string;
  group: string;
  cols: number[];
  link: string;
}

export interface RecordItem {
  _section: string;
  _row: number;
  fields: Record<string, string>;
}

export interface KBData {
  importantNotes: string[];
  fieldOrder: FieldOrder[];
  records: RecordItem[];
  primaryKey: string;
  descKey: string;
  hasGroup?: boolean;
  hasSections?: boolean;
}

export interface Tab {
  name: string;
  kind: 'cases' | 'table';
  view: 'smart' | 'table';
  skip: Record<number, boolean>;
  grid: GridCell[][];
  gridJson?: string;
  kb: KBData;
}

export interface Workbook {
  tabs: Tab[];
  fileName: string;
  versionId?: string;
  isSample?: boolean;
}

export interface SearchResult {
  rec: RecordItem;
  score: number;
  matchKey: string | null;
  snippet: string | null;
}

export interface MemberDoc {
  email: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdminDoc {
  email: string;
  grantedBy: string;
  grantedAt: string;
}

export interface BlockedDoc {
  email: string;
  blockedBy: string;
  blockedAt: string;
}
