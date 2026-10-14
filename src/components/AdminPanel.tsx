import React, { useState, useEffect, useRef } from 'react';
import { AuthUser, Workbook } from '../types';
import {
  ShieldCheck,
  Upload,
  AlertCircle,
  FileSpreadsheet,
  CheckCircle2,
  Users,
  Ban,
  ShieldAlert,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { DryRunReport, computeKBDryRun } from '../utils/kbDiffEngine';
import { parseWorkbookBytes } from '../utils/workbookParser';
import { AdminsTab } from './AdminsTab';
import { BlockedEmailsTab } from './BlockedEmailsTab';
import { RulesSelfTestPanel } from './RulesSelfTestPanel';

interface AdminPanelProps {
  currentUser: AuthUser;
  onClose: () => void;
  onShowToast: (msg: string) => void;
  onWorkbookUpdated?: (wb: Workbook) => void;
}

interface KBVersionItem {
  versionId: string;
  fileName: string;
  status: string;
  publishedAt: string | null;
  publishedBy: string;
  totalTabs: number;
  totalRecords: number;
  totalChunks: number;
  versionChecksum?: string;
  tabNames: string[];
  isDefault?: boolean;
  isSample?: boolean;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUser,
  onClose,
  onShowToast,
  onWorkbookUpdated,
}) => {
  const isMainAdmin = currentUser.role === 'Main Admin';
  const [activeTab, setActiveTab] = useState<'kb-manage' | 'admins' | 'blocked' | 'rules-selftest' | 'overview'>('kb-manage');

  // KB Ingestion State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<Workbook | null>(null);
  const [isAnalyzingDryRun, setIsAnalyzingDryRun] = useState<boolean>(false);
  const [dryRunReport, setDryRunReport] = useState<DryRunReport | null>(null);
  const [explicitConfirmationChecked, setExplicitConfirmationChecked] = useState<boolean>(false);

  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [versions, setVersions] = useState<KBVersionItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(false);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch version history when tab is opened
  useEffect(() => {
    if (activeTab === 'kb-manage') {
      fetchVersions();
    }
  }, [activeTab]);

  const fetchVersions = async () => {
    setLoadingVersions(true);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) return;

      const res = await fetch('/api/kb/versions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch (e) {
      console.error('Failed to fetch KB versions:', e);
    } finally {
      setLoadingVersions(false);
    }
  };

  // Browser-side parsing: FileReader -> Uint8Array -> XLSX.read(data, { type: 'array' })
  // Zero Node Buffer in browser code.
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
        setActionError('Only Excel (.xlsx, .xls) and CSV (.csv) files are supported.');
        setSelectedFile(null);
        setParsedWorkbook(null);
        setDryRunReport(null);
        return;
      }

      setSelectedFile(file);
      setActionError(null);
      setDryRunReport(null);
      setExplicitConfirmationChecked(false);
      setIsAnalyzingDryRun(true);

      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const buffer = ev.target?.result as ArrayBuffer;
          const uint8 = new Uint8Array(buffer);
          // Parse completely in browser using the verified parser
          const parsed = parseWorkbookBytes(uint8, file.name);
          setParsedWorkbook(parsed);

          // Retrieve active workbook for comparison
          let currentWb: Workbook | null = null;
          try {
            const token = await (window as any).__getAuthToken?.();
            if (token) {
              const res = await fetch('/api/kb/active', {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                currentWb = await res.json();
              }
            }
          } catch {}

          // Compute and show dry run in the browser
          const report = computeKBDryRun(currentWb, parsed);
          setDryRunReport(report);
        } catch (err: any) {
          setActionError('Spreadsheet parse error: ' + (err.message || err));
        } finally {
          setIsAnalyzingDryRun(false);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Publish: Send the already-parsed JSON to POST /api/kb/upload with the Firebase ID token.
  // The server verifies admin status, validates structure and sizes, builds chunks,
  // stages them, verifies them, and only then updates /meta/kb.
  // The browser NEVER writes to Firestore directly; direct-write fallback is deleted.
  const handlePublishActive = async () => {
    if (!selectedFile || !parsedWorkbook || !dryRunReport) return;

    if (dryRunReport.requiresExplicitConfirmation && !explicitConfirmationChecked) {
      setActionError('You must check the explicit confirmation box to proceed with missing tabs or large decreases.');
      return;
    }

    setIsPublishing(true);
    setActionError(null);

    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) {
        setActionError('Authentication token unavailable.');
        setIsPublishing(false);
        return;
      }

      const res = await fetch('/api/kb/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          parsedWorkbook,
          explicitConfirmation: explicitConfirmationChecked,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onShowToast(`Successfully published ${data.fileName} (${data.totalRecords} records across ${data.totalTabs} sheets in ${data.totalChunks} chunks)`);
        setSelectedFile(null);
        setParsedWorkbook(null);
        setDryRunReport(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchVersions();
        if (onWorkbookUpdated && data.tabs) {
          onWorkbookUpdated({
            tabs: data.tabs,
            fileName: data.fileName,
          });
        }
      } else {
        setActionError(data.error || 'Server publishing failed.');
      }
    } catch (e: any) {
      setActionError(e.message || 'Error publishing version.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCancelDryRun = () => {
    setDryRunReport(null);
    setSelectedFile(null);
    setParsedWorkbook(null);
    setExplicitConfirmationChecked(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onShowToast('Import cancelled. Active Knowledge Base remains unchanged.');
  };

  const handleRollback = async (targetVersionId: string) => {
    if (!confirm(`Are you sure you want to rollback to version ${targetVersionId}?`)) return;

    setRollingBackId(targetVersionId);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) return;

      const res = await fetch('/api/kb/rollback', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetVersionId }),
      });

      const data = await res.json();
      if (res.ok) {
        onShowToast(`Rolled back to ${data.fileName}`);
        fetchVersions();
        const activeRes = await fetch('/api/kb/active', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (activeRes.ok) {
          const activeData = await activeRes.json();
          if (onWorkbookUpdated && activeData.tabs) {
            onWorkbookUpdated({
              tabs: activeData.tabs,
              fileName: activeData.fileName,
            });
          }
        }
      } else {
        alert(data.error || 'Rollback failed.');
      }
    } catch (e: any) {
      alert(`Error during rollback: ${e.message}`);
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <div className="modal show" role="dialog" aria-modal="true">
        <div className="modal-card !w-[min(920px,96vw)] max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="modal-head !py-3.5 !px-5 bg-[var(--panel)] border-b border-[var(--line)] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] text-[var(--accent-contrast)] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-[var(--text)] leading-tight">
                  Administration Center
                </h3>
                <span className="text-[10px] font-mono text-[var(--muted-2)]">
                  Signed in as {currentUser.email} ({currentUser.role})
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="drawer-close ml-auto"
              aria-label="Close admin modal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Sub Navigation */}
          <div className="flex items-center gap-2 px-5 py-2.5 bg-[var(--panel-2)] border-b border-[var(--line)] text-xs font-semibold shrink-0 overflow-x-auto">
            <button
              onClick={() => setActiveTab('kb-manage')}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'kb-manage'
                  ? 'bg-[var(--panel)] text-[var(--accent-contrast)] shadow-sm font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>KB Ingestion & Dry-Run</span>
            </button>
            <button
              onClick={() => setActiveTab('admins')}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'admins'
                  ? 'bg-[var(--panel)] text-[var(--accent-contrast)] shadow-sm font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Admins</span>
            </button>
            {isMainAdmin && (
              <button
                onClick={() => setActiveTab('blocked')}
                className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === 'blocked'
                    ? 'bg-[var(--panel)] text-[var(--accent-contrast)] shadow-sm font-bold'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <Ban className="w-3.5 h-3.5 text-[var(--red)]" />
                <span>Blocked emails</span>
              </button>
            )}
            <button
              onClick={() => setActiveTab('rules-selftest')}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'rules-selftest'
                  ? 'bg-[var(--panel)] text-[var(--accent-contrast)] shadow-sm font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Rules Self-Test</span>
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-[var(--panel)] text-[var(--accent-contrast)] shadow-sm font-bold'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              Access Hierarchy
            </button>
          </div>

          {/* Body */}
          <div className="modal-body !p-5 space-y-4 overflow-y-auto flex-1">
            {activeTab === 'admins' && (
              <AdminsTab
                currentUser={currentUser}
                onShowToast={onShowToast}
              />
            )}

            {activeTab === 'blocked' && isMainAdmin && (
              <BlockedEmailsTab
                currentUser={currentUser}
                onShowToast={onShowToast}
              />
            )}

            {activeTab === 'rules-selftest' && (
              <RulesSelfTestPanel
                currentUser={currentUser}
                onShowToast={onShowToast}
              />
            )}

            {activeTab === 'overview' && (
              <div className="space-y-4 text-xs">
                <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded-xl p-4">
                  <h4 className="font-bold text-sm text-[var(--text)] mb-2">Breadfast Company Access Model</h4>
                  <ul className="list-disc list-inside space-y-1.5 text-[var(--muted)] leading-relaxed">
                    <li><strong>All @breadfast.com Accounts:</strong> Any employee with a verified company Google email can sign in and read the Knowledge Base. No per-user import or allowlist is required.</li>
                    <li><strong>Main Admin:</strong> Permanently anchored in security rules to <code>breadfast.hotfood@gmail.com</code> (immutable). Can manage KB, grant/revoke Admins, and block company emails.</li>
                    <li><strong>Administrators:</strong> Granted company users (with an <code>admins/&#123;email&#125;</code> record). Can publish/rollback KB, view signed-in members, and grant/revoke other Admins.</li>
                    <li><strong>Offboarding (Blocked):</strong> The Main Admin can block departed employee accounts in <code>blocked/&#123;email&#125;</code>, cutting off access immediately.</li>
                    <li><strong>External Accounts:</strong> All non-company Google accounts (and other @gmail.com accounts) are strictly denied by Firestore security rules.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* KB Ingestion, Dry-Run & Version Management */}
            {activeTab === 'kb-manage' && (
              <div className="space-y-4">
                {/* Step 1: File Selection & Instant Browser-Side Parse */}
                <div className="bg-[var(--panel-2)] border border-[var(--line)] rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-[var(--accent)]" />
                    <h4 className="text-xs font-bold text-[var(--text)]">Knowledge Base File Ingestion & Pre-Flight Review</h4>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Upload an updated workbook (e.g. <code>Chatting_Team_KB.xlsx</code>). The file is parsed completely in the browser with <code>FileReader → Uint8Array → XLSX.read(data, &#123;type:'array'&#125;)</code>, generating an instant pre-flight dry-run review before sending anything to the server.
                  </p>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileSelect}
                      className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--accent-dim)] file:text-[var(--accent-contrast)] hover:file:opacity-90"
                    />
                    {isAnalyzingDryRun && (
                      <span className="text-xs text-[var(--muted)] animate-pulse">
                        Reading and computing dry-run diff in browser...
                      </span>
                    )}
                  </div>

                  {actionError && (
                    <div className="p-2.5 bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 rounded-lg text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}
                </div>

                {/* Step 2: Dry-Run Diff Inspection Results Modal/Card */}
                {dryRunReport && (
                  <div className="bg-[var(--panel)] border-2 border-[var(--accent)]/40 rounded-xl p-4 space-y-3 shadow-md">
                    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2.5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-[var(--accent)]" />
                        <h4 className="text-xs font-extrabold text-[var(--text)]">
                          Pre-Flight Dry-Run Inspection Report: {dryRunReport.fileName}
                        </h4>
                      </div>
                      <span className="text-[10px] font-mono bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded font-bold">
                        Browser Dry-Run (Non-Destructive)
                      </span>
                    </div>

                    {/* Active KB Context Banner */}
                    {dryRunReport.isActiveSample ? (
                      <div className="p-3 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-2 font-bold text-blue-900 dark:text-blue-200">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                          <span>Active KB: Sample data - not a published version</span>
                        </div>
                        <p className="text-blue-800 dark:text-blue-300 text-[11px] leading-relaxed">
                          This import will publish your first official Knowledge Base version, replacing the initial sample data. No false drop or missing-tab warnings are raised against sample data.
                        </p>
                      </div>
                    ) : null}

                    {/* Overall Summary Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                      <div className="bg-[var(--panel-2)] p-2 rounded-lg border border-[var(--line)]">
                        <span className="text-[10px] text-[var(--muted-2)] uppercase block font-mono">Added</span>
                        <span className="text-sm font-bold text-[var(--green)]">+{dryRunReport.overallAdded}</span>
                      </div>
                      <div className="bg-[var(--panel-2)] p-2 rounded-lg border border-[var(--line)]">
                        <span className="text-[10px] text-[var(--muted-2)] uppercase block font-mono">Updated</span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{dryRunReport.overallUpdated}</span>
                      </div>
                      <div className="bg-[var(--panel-2)] p-2 rounded-lg border border-[var(--line)]">
                        <span className="text-[10px] text-[var(--muted-2)] uppercase block font-mono">Unchanged</span>
                        <span className="text-sm font-bold text-[var(--muted)]">{dryRunReport.overallUnchanged}</span>
                      </div>
                      <div className="bg-[var(--panel-2)] p-2 rounded-lg border border-[var(--line)]">
                        <span className="text-[10px] text-[var(--muted-2)] uppercase block font-mono">Removed</span>
                        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">-{dryRunReport.overallRemoved}</span>
                      </div>
                      <div className="bg-[var(--panel-2)] p-2 rounded-lg border border-[var(--line)]">
                        <span className="text-[10px] text-[var(--muted-2)] uppercase block font-mono">Rejected</span>
                        <span className="text-sm font-bold text-[var(--red)]">{dryRunReport.overallRejected}</span>
                      </div>
                    </div>

                    {/* Warnings & Missing Tabs Banner */}
                    {dryRunReport.requiresExplicitConfirmation && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-lg text-xs space-y-2">
                        <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                          <span>Explicit Confirmation Required (Anomalies / Missing Tabs Detected)</span>
                        </div>
                        <ul className="list-disc pl-5 text-amber-800 dark:text-amber-300 space-y-1 text-[11px]">
                          {dryRunReport.confirmationWarnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                        <label className="flex items-center gap-2 pt-1 font-semibold text-amber-950 dark:text-amber-100 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={explicitConfirmationChecked}
                            onChange={(e) => setExplicitConfirmationChecked(e.target.checked)}
                            className="rounded border-amber-400 text-[var(--accent)]"
                          />
                          <span>I explicitly acknowledge and confirm publishing despite missing tabs / record count decrease.</span>
                        </label>
                      </div>
                    )}

                    {/* Tab-by-Tab Breakdown Table */}
                    <div className="border border-[var(--line)] rounded-lg overflow-hidden text-xs max-h-52 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="bg-[var(--panel-2)] text-[var(--muted-2)] font-mono text-[10px] uppercase sticky top-0">
                          <tr>
                            <th className="p-2">Sheet / Tab</th>
                            <th className="p-2 text-center">Before → After</th>
                            <th className="p-2 text-center text-[var(--green)]">Added</th>
                            <th className="p-2 text-center text-blue-500">Updated</th>
                            <th className="p-2 text-center text-[var(--muted)]">Same</th>
                            <th className="p-2 text-center text-amber-500">Removed</th>
                            <th className="p-2 text-center text-[var(--red)]">Rejected</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--line)]">
                          {dryRunReport.tabsSummary.map((t) => (
                            <tr key={t.tabName} className="hover:bg-[var(--panel-2)]/50">
                              <td className="p-2 font-medium truncate max-w-[200px]" title={t.tabName}>
                                {t.tabName}
                              </td>
                              <td className="p-2 text-center font-mono text-[11px]">
                                {t.totalBefore} → {t.totalAfter}
                              </td>
                              <td className="p-2 text-center font-mono text-[var(--green)] font-semibold">
                                {t.addedCount > 0 ? `+${t.addedCount}` : '0'}
                              </td>
                              <td className="p-2 text-center font-mono text-blue-500">
                                {t.updatedCount}
                              </td>
                              <td className="p-2 text-center font-mono text-[var(--muted)]">
                                {t.unchangedCount}
                              </td>
                              <td className="p-2 text-center font-mono text-amber-500 font-semibold">
                                {t.removedCount > 0 ? `-${t.removedCount}` : '0'}
                              </td>
                              <td className="p-2 text-center font-mono text-[var(--red)] font-semibold">
                                {t.rejectedCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Action Error Banner inside Dry-Run Card */}
                    {actionError && (
                      <div className="p-3 bg-red-50 text-red-700 dark:bg-red-950/70 dark:text-red-300 rounded-lg text-xs flex items-center gap-2 border border-red-200 dark:border-red-800">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="font-semibold">{actionError}</span>
                      </div>
                    )}

                    {/* Actions: Cancel vs Confirm & Publish */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                      <button
                        onClick={handleCancelDryRun}
                        className="btn ghost text-xs text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        Cancel & Discard Import (Leave Active KB Unchanged)
                      </button>

                      <div className="flex items-center gap-2">
                        {dryRunReport.requiresExplicitConfirmation && !explicitConfirmationChecked && (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                            ← Check confirmation box to enable
                          </span>
                        )}
                        <button
                          onClick={handlePublishActive}
                          disabled={isPublishing || (dryRunReport.requiresExplicitConfirmation && !explicitConfirmationChecked)}
                          className="btn primary text-xs !py-1.5 !px-4 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                        >
                          {isPublishing ? 'Server Staging, Verifying & Activating...' : 'Publish Active Version (Server Authoritative)'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 3: Version History Table (Retains Last 3 Published Versions) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[var(--muted-2)]" />
                        <span>Version History & Rollback (Retaining Last 3 Published Versions)</span>
                      </h4>
                      <span className="text-[10px] text-[var(--muted-2)]">
                        Each version verified with SHA-256 chunk checksums and safe UTF-8 limits (≤ 750 KiB/chunk).
                      </span>
                    </div>
                    <button
                      onClick={fetchVersions}
                      disabled={loadingVersions}
                      className="btn ghost text-[11px] !p-1 text-[var(--muted)]"
                    >
                      {loadingVersions ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  <div className="border border-[var(--line)] rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-[var(--panel-2)] text-[var(--muted-2)] font-mono text-[10px] uppercase">
                        <tr>
                          <th className="p-2.5">Version ID</th>
                          <th className="p-2.5">File Name</th>
                          <th className="p-2.5">Records / Sheets / Chunks</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5 text-right">Rollback Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line)]">
                        {versions.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-4 text-center text-[var(--muted)]">
                              {loadingVersions ? 'Loading versions...' : 'No prior versions available.'}
                            </td>
                          </tr>
                        ) : (
                          versions.map((v) => (
                            <tr key={v.versionId} className="hover:bg-[var(--panel-2)]/50">
                              <td className="p-2.5 font-mono text-[11px] font-bold">
                                {v.versionId}
                                {(v.isDefault || v.isSample) && (
                                  <span className="ml-1.5 px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded text-[9px] font-semibold">
                                    Sample data - not a published version
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 font-medium truncate max-w-[160px]" title={v.fileName}>
                                {v.fileName}
                              </td>
                              <td className="p-2.5 text-[var(--muted)]">
                                {v.totalRecords} records ({v.totalTabs} sheets, {v.totalChunks || 1} chunks)
                              </td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  v.status === 'active'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                                    : v.status === 'failed'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                                }`}>
                                  {v.status || 'published'}
                                </span>
                              </td>
                              <td className="p-2.5 text-right">
                                <button
                                  onClick={() => handleRollback(v.versionId)}
                                  disabled={rollingBackId === v.versionId || v.status === 'failed'}
                                  className="btn ghost text-[11px] !py-1 !px-2 text-[var(--accent-contrast)] font-semibold disabled:opacity-30"
                                  title="Rollback active KB to this version"
                                >
                                  {rollingBackId === v.versionId ? 'Rolling back...' : 'Rollback'}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
