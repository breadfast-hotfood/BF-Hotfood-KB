import { Workbook, Tab, RecordItem } from '../types';

export interface RecordDiffSummary {
  tabName: string;
  totalBefore: number;
  totalAfter: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  removedCount: number;
  rejectedCount: number;
  validationErrors: string[];
}

export interface DryRunReport {
  fileName: string;
  totalTabs: number;
  totalRecordsAfter: number;
  totalRecordsBefore: number;
  overallAdded: number;
  overallUpdated: number;
  overallUnchanged: number;
  overallRemoved: number;
  overallRejected: number;
  missingTabs: string[];
  newTabs: string[];
  largeDecreaseDetected: boolean;
  requiresExplicitConfirmation: boolean;
  confirmationWarnings: string[];
  tabsSummary: RecordDiffSummary[];
  isActiveSample?: boolean;
}

export function isSampleKB(wb: Workbook | null | undefined): boolean {
  if (!wb) return true;
  if (wb.isSample === true) return true;
  if (!wb.versionId || wb.versionId === 'test-v1-initial' || wb.versionId === 'sample-initial') return true;
  if (wb.fileName === 'Breadfast_CX_KB_Initial.xlsx' || wb.fileName === 'Sample_Breadfast_CX_KB.xlsx') return true;
  if (wb.tabs && wb.tabs.length <= 2) {
    const totalRecs = wb.tabs.reduce((acc, t) => acc + (t.kb?.records?.length || 0), 0);
    if (totalRecs <= 5) return true;
  }
  return false;
}

export function computeKBDryRun(
  currentWorkbook: Workbook | null,
  newWorkbook: Workbook
): DryRunReport {
  const isSampleActive = isSampleKB(currentWorkbook);

  const currentTabsMap = new Map<string, Tab>();
  if (!isSampleActive && currentWorkbook && currentWorkbook.tabs) {
    currentWorkbook.tabs.forEach(t => currentTabsMap.set(t.name.trim().toLowerCase(), t));
  }

  const newTabsMap = new Map<string, Tab>();
  newWorkbook.tabs.forEach(t => newTabsMap.set(t.name.trim().toLowerCase(), t));

  const missingTabs: string[] = [];
  const newTabs: string[] = [];
  const confirmationWarnings: string[] = [];

  // Check for missing tabs ONLY when comparing against a real published KB
  if (!isSampleActive) {
    currentTabsMap.forEach((oldTab, key) => {
      if (!newTabsMap.has(key)) {
        missingTabs.push(oldTab.name);
        confirmationWarnings.push(`Tab "${oldTab.name}" exists in active KB but is MISSING from the uploaded workbook.`);
      }
    });
  }

  // Check for new tabs
  newTabsMap.forEach((newTab, key) => {
    if (!currentTabsMap.has(key)) {
      newTabs.push(newTab.name);
    }
  });

  const tabsSummary: RecordDiffSummary[] = [];
  let overallAdded = 0;
  let overallUpdated = 0;
  let overallUnchanged = 0;
  let overallRemoved = 0;
  let overallRejected = 0;
  let totalRecordsBefore = 0;
  let totalRecordsAfter = 0;

  for (const newTab of newWorkbook.tabs) {
    const key = newTab.name.trim().toLowerCase();
    const oldTab = !isSampleActive ? currentTabsMap.get(key) : undefined;

    const oldRecords = oldTab?.kb?.records || [];
    const newRecords = newTab.kb?.records || [];

    totalRecordsBefore += oldRecords.length;
    totalRecordsAfter += newRecords.length;

    const validationErrors: string[] = [];
    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let rejectedCount = 0;

    if (isSampleActive) {
      // Clean addition of real workbook records without false drop warnings against sample
      addedCount = newRecords.length;
    } else {
      // Index old records by primary key value
      const oldByPk = new Map<string, RecordItem>();
      const pkKey = oldTab?.kb?.primaryKey || newTab.kb?.primaryKey || '';

      oldRecords.forEach(rec => {
        const pkVal = (rec.fields[pkKey] || Object.values(rec.fields)[0] || '').trim().toLowerCase();
        if (pkVal) oldByPk.set(pkVal, rec);
      });

      const seenNewPks = new Set<string>();

      newRecords.forEach((rec, idx) => {
        const pkVal = (rec.fields[pkKey] || Object.values(rec.fields)[0] || '').trim();

        // Validation check
        if (!pkVal) {
          rejectedCount++;
          validationErrors.push(`Row ${rec._row || idx + 1}: Missing primary key value.`);
          return;
        }

        const lowerPk = pkVal.toLowerCase();
        if (seenNewPks.has(lowerPk)) {
          validationErrors.push(`Row ${rec._row || idx + 1}: Duplicate primary key value "${pkVal}".`);
        }
        seenNewPks.add(lowerPk);

        const oldRec = oldByPk.get(lowerPk);
        if (!oldRec) {
          addedCount++;
        } else {
          // Compare fields
          const oldFields = oldRec.fields || {};
          const newFields = rec.fields || {};
          const allKeys = Array.from(new Set([...Object.keys(oldFields), ...Object.keys(newFields)]));

          let hasChange = false;
          for (const k of allKeys) {
            if ((oldFields[k] || '').trim() !== (newFields[k] || '').trim()) {
              hasChange = true;
              break;
            }
          }

          if (hasChange) {
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
      });

      // Check removed records from old tab
      let removedCount = 0;
      oldRecords.forEach(oldRec => {
        const pkVal = (oldRec.fields[pkKey] || Object.values(oldRec.fields)[0] || '').trim().toLowerCase();
        if (pkVal && !seenNewPks.has(pkVal)) {
          removedCount++;
        }
      });

      // Check for large decrease in this tab (>25% reduction)
      if (oldRecords.length > 5 && newRecords.length < oldRecords.length * 0.75) {
        confirmationWarnings.push(
          `Tab "${newTab.name}" decreased by ${oldRecords.length - newRecords.length} records (${Math.round((1 - newRecords.length / oldRecords.length) * 100)}% drop).`
        );
      }
    }

    tabsSummary.push({
      tabName: newTab.name,
      totalBefore: isSampleActive ? 0 : oldRecords.length,
      totalAfter: newRecords.length,
      addedCount: isSampleActive ? newRecords.length : addedCount,
      updatedCount: isSampleActive ? 0 : updatedCount,
      unchangedCount: isSampleActive ? 0 : unchangedCount,
      removedCount: isSampleActive ? 0 : (oldRecords.length - (newRecords.length - addedCount)),
      rejectedCount,
      validationErrors,
    });

    overallAdded += (isSampleActive ? newRecords.length : addedCount);
    overallUpdated += (isSampleActive ? 0 : updatedCount);
    overallUnchanged += (isSampleActive ? 0 : unchangedCount);
    overallRemoved += (isSampleActive ? 0 : Math.max(0, oldRecords.length - newRecords.length));
    overallRejected += rejectedCount;
  }

  // Check overall large decrease (>20% reduction across entire KB) ONLY on real published KB
  let largeDecreaseDetected = false;
  if (!isSampleActive && totalRecordsBefore > 10 && totalRecordsAfter < totalRecordsBefore * 0.8) {
    largeDecreaseDetected = true;
    confirmationWarnings.push(
      `Overall KB record count dropped from ${totalRecordsBefore} to ${totalRecordsAfter} (${Math.round((1 - totalRecordsAfter / totalRecordsBefore) * 100)}% reduction).`
    );
  }

  const requiresExplicitConfirmation = !isSampleActive && (missingTabs.length > 0 || largeDecreaseDetected || confirmationWarnings.length > 0);

  return {
    fileName: newWorkbook.fileName,
    totalTabs: newWorkbook.tabs.length,
    totalRecordsAfter,
    totalRecordsBefore: isSampleActive ? 0 : totalRecordsBefore,
    overallAdded,
    overallUpdated,
    overallUnchanged,
    overallRemoved: isSampleActive ? 0 : overallRemoved,
    overallRejected,
    missingTabs,
    newTabs,
    largeDecreaseDetected,
    requiresExplicitConfirmation,
    confirmationWarnings,
    tabsSummary,
    isActiveSample: isSampleActive,
  };
}
