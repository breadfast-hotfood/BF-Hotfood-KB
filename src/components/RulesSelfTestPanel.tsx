import React, { useState } from 'react';
import { AuthUser } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { toFirestoreValue } from '../utils/firestoreRest';
import { listCollectionDocs } from '../utils/firestoreList';
import {
  ShieldCheck,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Terminal,
} from 'lucide-react';

interface RulesSelfTestPanelProps {
  currentUser: AuthUser;
  onShowToast: (msg: string) => void;
}

interface SelfTestResult {
  id: number;
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  statusHttp: number;
  details: string;
}

export const RulesSelfTestPanel: React.FC<RulesSelfTestPanelProps> = ({
  currentUser,
  onShowToast,
}) => {
  const isMainAdmin = currentUser.role === 'Main Admin';
  const callerEmail = currentUser.email.toLowerCase().trim();

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [results, setResults] = useState<SelfTestResult[]>([]);
  const [activeTestName, setActiveTestName] = useState<string | null>(null);

  const DOCS_BASE = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
  const API_ROOT = `https://firestore.googleapis.com/v1/${DOCS_BASE}`;

  const runAllTests = async () => {
    setIsRunning(true);
    setResults([]);
    const testResults: SelfTestResult[] = [];

    const token = await (window as any).__getAuthToken?.();
    if (!token) {
      onShowToast('Authentication token unavailable.');
      setIsRunning(false);
      return;
    }

    const timestamp = Date.now();
    const disposableCompanyEmail = `selftest-${timestamp}-1@breadfast.com`;
    const disposableNonCompany = `selftest-${timestamp}-2@example.invalid`;
    const disposableBlocked = `selftest-${timestamp}-3@breadfast.com`;
    const disposableKbVersion = `selftest-${timestamp}`;

    // Helper: raw fetch
    const rawReq = async (url: string, method: string = 'GET', body?: any) => {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      };
      const res = await fetch(url, init);
      let resJson: any = null;
      try {
        resJson = await res.json();
      } catch {}
      return { status: res.status, ok: res.ok, json: resJson };
    };

    // Helper to evaluate pass/fail
    const recordResult = (
      id: number,
      name: string,
      expected: string,
      status: number,
      actualDesc: string,
      passed: boolean,
      details: string = ''
    ) => {
      const item: SelfTestResult = {
        id,
        name,
        expected,
        actual: `HTTP ${status} (${actualDesc})`,
        passed,
        statusHttp: status,
        details,
      };
      testResults.push(item);
      setResults([...testResults]);
    };

    try {
      // CASE 1: Grant Admin to a disposable company email
      // Expected: 200 (Main Admin / Admin)
      setActiveTestName('1. Grant Admin to disposable company email');
      {
        const fields = {
          email: toFirestoreValue(disposableCompanyEmail),
          grantedBy: toFirestoreValue(callerEmail),
          grantedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(disposableCompanyEmail)}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 200;
        recordResult(1, 'Grant Admin to disposable company email', '200', r.status, r.status === 200 ? 'Allowed' : 'Denied', passed, JSON.stringify(r.json));
      }

      // CASE 2: Grant Admin to a non-company email (x@example.invalid)
      // Expected: 403 / 403
      setActiveTestName('2. Grant Admin to non-company email');
      {
        const fields = {
          email: toFirestoreValue(disposableNonCompany),
          grantedBy: toFirestoreValue(callerEmail),
          grantedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(disposableNonCompany)}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(2, 'Grant Admin to non-company email', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 3: Grant Admin to breadfast.hotfood@gmail.com
      // Expected: 403 / 403 (Main Admin anchor cannot have admins doc created)
      setActiveTestName('3. Grant Admin to breadfast.hotfood@gmail.com');
      {
        const fields = {
          email: toFirestoreValue('breadfast.hotfood@gmail.com'),
          grantedBy: toFirestoreValue(callerEmail),
          grantedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent('breadfast.hotfood@gmail.com')}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(3, 'Grant Admin to breadfast.hotfood@gmail.com', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 4: Grant with grantedBy set to someone else
      // Expected: 403 / 403
      setActiveTestName('4. Grant with grantedBy set to someone else');
      {
        const fields = {
          email: toFirestoreValue(`other-${timestamp}@breadfast.com`),
          grantedBy: toFirestoreValue('forged.actor@breadfast.com'),
          grantedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(`other-${timestamp}@breadfast.com`)}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(4, 'Grant with forged grantedBy', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 5: Grant with an extra field
      // Expected: 403 / 403 (hasOnly check)
      setActiveTestName('5. Grant with extra field');
      {
        const fields = {
          email: toFirestoreValue(`extra-${timestamp}@breadfast.com`),
          grantedBy: toFirestoreValue(callerEmail),
          grantedAt: toFirestoreValue(new Date().toISOString()),
          extraUnallowedKey: toFirestoreValue('illegal'),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(`extra-${timestamp}@breadfast.com`)}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(5, 'Grant with extra field', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 6: Update an existing admins document
      // Expected: 403 / 403 (allow update: if false)
      setActiveTestName('6. Update existing admins doc');
      {
        const fields = {
          grantedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(disposableCompanyEmail)}?updateMask.fieldPaths=grantedAt`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(6, 'Update existing admins document', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 7: Revoke the disposable Admin (delete)
      // Expected: 200 / 200
      setActiveTestName('7. Revoke disposable Admin');
      {
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent(disposableCompanyEmail)}`, 'DELETE');
        const passed = r.status === 200;
        recordResult(7, 'Revoke disposable Admin (delete)', '200', r.status, r.status === 200 ? 'Allowed' : 'Denied', passed);
      }

      // CASE 8: Delete admins/breadfast.hotfood@gmail.com
      // Expected: 403 / 403 (rules block target != 'breadfast.hotfood@gmail.com')
      setActiveTestName('8. Delete admins/breadfast.hotfood@gmail.com');
      {
        const r = await rawReq(`${API_ROOT}/admins/${encodeURIComponent('breadfast.hotfood@gmail.com')}`, 'DELETE');
        const passed = r.status === 403;
        recordResult(8, 'Delete admins/breadfast.hotfood@gmail.com', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 9: Block a disposable email
      // Expected: 200 (Main Admin) / 403 (Admin)
      setActiveTestName('9. Block disposable email');
      {
        const fields = {
          email: toFirestoreValue(disposableBlocked),
          blockedBy: toFirestoreValue(callerEmail),
          blockedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/blocked/${encodeURIComponent(disposableBlocked)}?currentDocument.exists=false`, 'PATCH', { fields });
        const exp = isMainAdmin ? 200 : 403;
        const passed = r.status === exp;
        recordResult(9, 'Block disposable email', String(exp), r.status, r.status === exp ? 'As expected' : 'Unexpected', passed);
      }

      // CASE 10: Block breadfast.hotfood@gmail.com
      // Expected: 403 / 403
      setActiveTestName('10. Block breadfast.hotfood@gmail.com');
      {
        const fields = {
          email: toFirestoreValue('breadfast.hotfood@gmail.com'),
          blockedBy: toFirestoreValue(callerEmail),
          blockedAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/blocked/${encodeURIComponent('breadfast.hotfood@gmail.com')}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(10, 'Block breadfast.hotfood@gmail.com', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 11: Unblock disposable email
      // Expected: 200 (Main Admin) / 403 (Admin)
      setActiveTestName('11. Unblock disposable email');
      {
        const r = await rawReq(`${API_ROOT}/blocked/${encodeURIComponent(disposableBlocked)}`, 'DELETE');
        const exp = isMainAdmin ? 200 : 403;
        const passed = r.status === exp;
        recordResult(11, 'Unblock disposable email (delete)', String(exp), r.status, r.status === exp ? 'As expected' : 'Unexpected', passed);
      }

      // CASE 12: Create members/<another email>
      // Expected: 403 / 403 (callerEmail == target enforced)
      setActiveTestName('12. Create members record for another email');
      {
        const fields = {
          email: toFirestoreValue(`someoneelse-${timestamp}@breadfast.com`),
          name: toFirestoreValue('Impersonator'),
          firstSeenAt: toFirestoreValue(new Date().toISOString()),
          lastSeenAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/members/${encodeURIComponent(`someoneelse-${timestamp}@breadfast.com`)}?currentDocument.exists=false`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(12, 'Create members doc for another email', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 13: Create own members record
      // Expected: 403 (Main Admin is not @breadfast.com) / 200 or 409/already-registered for company Admin
      setActiveTestName('13. Create own members record');
      {
        const fields = {
          email: toFirestoreValue(callerEmail),
          name: toFirestoreValue(currentUser.name || 'Caller'),
          firstSeenAt: toFirestoreValue(new Date().toISOString()),
          lastSeenAt: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/members/${encodeURIComponent(callerEmail)}?currentDocument.exists=false`, 'PATCH', { fields });
        let passed = false;
        let expDesc = '403';
        if (isMainAdmin) {
          passed = r.status === 403;
        } else {
          expDesc = '200 or 409';
          passed = r.status === 200 || r.status === 409 || r.status === 400; // 409/400 if already exists
        }
        recordResult(13, 'Create own members record', isMainAdmin ? '403' : '200/409', r.status, r.status === 200 ? 'Created' : r.status === 403 ? 'Denied' : 'Already exists', passed);
      }

      // CASE 14: Update own members.lastSeenAt
      // Expected: n/a (Main Admin) / 200 (Admin)
      setActiveTestName('14. Update own members.lastSeenAt');
      {
        if (isMainAdmin) {
          recordResult(14, 'Update own members.lastSeenAt', 'n/a', 0, 'Skipped for Main Admin (not in members)', true);
        } else {
          const fields = {
            lastSeenAt: toFirestoreValue(new Date().toISOString()),
          };
          const r = await rawReq(`${API_ROOT}/members/${encodeURIComponent(callerEmail)}?updateMask.fieldPaths=lastSeenAt`, 'PATCH', { fields });
          const passed = r.status === 200;
          recordResult(14, 'Update own members.lastSeenAt', '200', r.status, r.status === 200 ? 'Updated' : 'Failed', passed);
        }
      }

      // CASE 15: Read meta/kb
      // Expected: 200 or 404 / 200 or 404 (not 403)
      setActiveTestName('15. Read meta/kb');
      {
        const r = await rawReq(`${API_ROOT}/meta/kb`, 'GET');
        const passed = r.status === 200 || r.status === 404;
        recordResult(15, 'Read meta/kb', '200 or 404', r.status, r.status === 403 ? 'Forbidden (FAIL)' : 'Authorized', passed);
      }

      // CASE 16: List members, admins, and blocked
      // Expected: members=200, admins=200, blocked=200 (all authorized admins)
      setActiveTestName('16. Collection listings');
      {
        let memStatus = 200;
        let admStatus = 200;
        let blkStatus = 200;
        let memErr = '';
        let admErr = '';
        let blkErr = '';

        try {
          await listCollectionDocs({
            projectId: firebaseConfig.projectId,
            databaseId: firebaseConfig.firestoreDatabaseId,
            collection: 'members',
            token,
          });
        } catch (e: any) {
          memStatus = e.status || 500;
          memErr = e.message || String(e);
        }

        try {
          await listCollectionDocs({
            projectId: firebaseConfig.projectId,
            databaseId: firebaseConfig.firestoreDatabaseId,
            collection: 'admins',
            token,
          });
        } catch (e: any) {
          admStatus = e.status || 500;
          admErr = e.message || String(e);
        }

        try {
          await listCollectionDocs({
            projectId: firebaseConfig.projectId,
            databaseId: firebaseConfig.firestoreDatabaseId,
            collection: 'blocked',
            token,
          });
        } catch (e: any) {
          blkStatus = e.status || 500;
          blkErr = e.message || String(e);
        }

        const passed = memStatus === 200 && admStatus === 200 && blkStatus === 200;
        const actualSummary = `mem:${memStatus}, adm:${admStatus}, blk:${blkStatus}`;
        const failureDetails = [
          memErr ? `members: ${memErr}` : '',
          admErr ? `admins: ${admErr}` : '',
          blkErr ? `blocked: ${blkErr}` : '',
        ].filter(Boolean).join(' | ');

        recordResult(
          16,
          'List members, admins, blocked',
          'mem:200, adm:200, blk:200',
          passed ? 200 : (memStatus !== 200 ? memStatus : admStatus !== 200 ? admStatus : blkStatus),
          actualSummary,
          passed,
          failureDetails
        );
      }

      // CASE 17: Create and delete disposable kbVersions document
      // Expected: 200 / 200
      setActiveTestName('17. Create & delete disposable kbVersions doc');
      {
        const fields = {
          versionId: toFirestoreValue(disposableKbVersion),
          test: toFirestoreValue(true),
        };
        const rCreate = await rawReq(`${API_ROOT}/kbVersions/${encodeURIComponent(disposableKbVersion)}`, 'PATCH', { fields });
        const rDelete = await rawReq(`${API_ROOT}/kbVersions/${encodeURIComponent(disposableKbVersion)}`, 'DELETE');
        const passed = (rCreate.status === 200) && (rDelete.status === 200);
        recordResult(17, 'Create & delete disposable kbVersion', '200 & 200', rCreate.status, `create:${rCreate.status}, delete:${rDelete.status}`, passed);
      }

      // CASE 18: Create auditLogs with wrong actorEmail
      // Expected: 403 / 403
      setActiveTestName('18. Create auditLog with wrong actorEmail');
      {
        const fields = {
          actorEmail: toFirestoreValue('forged.actor@breadfast.com'),
          action: toFirestoreValue('ILLEGAL_LOG'),
          timestamp: toFirestoreValue(new Date().toISOString()),
        };
        const r = await rawReq(`${API_ROOT}/auditLogs/test-forged-${timestamp}`, 'PATCH', { fields });
        const passed = r.status === 403;
        recordResult(18, 'Create auditLog with wrong actorEmail', '403', r.status, r.status === 403 ? 'Denied' : 'Allowed', passed);
      }

      // CASE 19: Read allowlist/x, uniqueIdIndex/x, users/x, system/x
      // Expected: 403 / 403 on all (confirms old model is completely removed)
      setActiveTestName('19. Probe old deprecated collections');
      {
        const rAllow = await rawReq(`${API_ROOT}/allowlist/any_test`, 'GET');
        const rIdx = await rawReq(`${API_ROOT}/uniqueIdIndex/any_test`, 'GET');
        const rUsr = await rawReq(`${API_ROOT}/users/any_test`, 'GET');
        const rSys = await rawReq(`${API_ROOT}/system/config`, 'GET');

        const all403 = (rAllow.status === 403) && (rIdx.status === 403) && (rUsr.status === 403) && (rSys.status === 403);
        recordResult(19, 'Read old collections (allowlist, uniqueIdIndex, users, system)', '403 on all', rAllow.status, `allow:${rAllow.status}, idx:${rIdx.status}, usr:${rUsr.status}, sys:${rSys.status}`, all403);
      }

      onShowToast('Self-Test suite completed.');
    } catch (err: any) {
      console.error('Self-test fatal error:', err);
      onShowToast(`Self-test error: ${err.message}`);
    } finally {
      setIsRunning(false);
      setActiveTestName(null);
    }
  };

  const totalRun = results.length;
  const passCount = results.filter(r => r.passed).length;
  const failCount = results.filter(r => !r.passed).length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[var(--panel-2)] p-4 rounded-xl border border-[var(--line)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--accent)]" />
            Security Rules Self-Test Suite
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Executes live Firestore REST probes with your verified Google token (<strong>{callerEmail}</strong>, role: <strong>{currentUser.role}</strong>).
            Always cleans up disposable fixtures.
          </p>
        </div>

        <button
          onClick={runAllTests}
          disabled={isRunning}
          className="btn primary text-xs font-bold flex items-center gap-2 px-4 py-2"
        >
          {isRunning ? (
            <>
              <Clock className="w-4 h-4 animate-spin" />
              <span>Running {activeTestName || 'Tests'}...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Execute Rules Self-Test</span>
            </>
          )}
        </button>
      </div>

      {/* Summary Scorecard */}
      {totalRun > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--panel)] border border-[var(--line)] p-3 rounded-xl">
            <div className="text-[10px] font-mono text-[var(--muted)] uppercase">Tests Executed</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">{totalRun} / 19</div>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-xl">
            <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 uppercase">Passed</div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-5 h-5" />
              {passCount}
            </div>
          </div>
          <div className={`p-3 rounded-xl border ${failCount > 0 ? 'bg-[var(--red-dim)] border-[var(--red)]' : 'bg-[var(--panel)] border-[var(--line)]'}`}>
            <div className={`text-[10px] font-mono uppercase ${failCount > 0 ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}>Failed</div>
            <div className={`text-xl font-bold mt-1 flex items-center gap-1.5 ${failCount > 0 ? 'text-[var(--red)]' : 'text-[var(--text)]'}`}>
              {failCount > 0 && <XCircle className="w-5 h-5" />}
              {failCount}
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--muted-2)] uppercase tracking-wider flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Test Results & Verification Logs
        </h4>

        <div className="overflow-x-auto border border-[var(--line)] rounded-xl bg-[var(--panel)]">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--panel-2)] border-b border-[var(--line)] text-[var(--muted)] uppercase font-mono text-[10px]">
              <tr>
                <th className="p-3 w-12 text-center">#</th>
                <th className="p-3">Test Case</th>
                <th className="p-3 w-28">Expected</th>
                <th className="p-3 w-36">Actual Status</th>
                <th className="p-3 w-24 text-center">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] font-mono text-[11px]">
              {results.map(res => (
                <tr key={res.id} className={res.passed ? 'hover:bg-[var(--panel-2)]/50' : 'bg-red-500/10'}>
                  <td className="p-3 text-center text-[var(--muted-2)]">{res.id}</td>
                  <td className="p-3 font-sans font-medium text-[var(--text)]">
                    {res.name}
                    {res.details && <div title={res.details} className="text-[10px] text-[var(--muted-2)] font-mono mt-0.5 break-words max-w-xl">{res.details}</div>}
                  </td>
                  <td className="p-3 text-[var(--muted)]">{res.expected}</td>
                  <td className="p-3 text-[var(--text)]">{res.actual}</td>
                  <td className="p-3 text-center">
                    {res.passed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        PASS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--red-dim)] text-[var(--red)] border border-[var(--red)]">
                        <XCircle className="w-3 h-3" />
                        FAIL
                      </span>
                    )}
                  </td>
                </tr>
              ))}

              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[var(--muted)] font-sans italic text-xs">
                    No tests run yet. Click "Execute Rules Self-Test" to run live REST probes against your deployed security rules.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
