import React, { useState, useEffect } from 'react';
import { AuthUser } from '../types';
import { BlockedDoc } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { listCollectionDocs } from '../utils/firestoreList';
import {
  blockEmail,
  unblockEmail,
} from '../utils/adminManagementRest';
import { MAIN_ADMIN_EMAIL } from '../utils/accessPayloads';
import {
  Ban,
  UserX,
  Trash2,
  Plus,
  RefreshCw,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

interface BlockedEmailsTabProps {
  currentUser: AuthUser;
  onShowToast: (msg: string) => void;
}

export const BlockedEmailsTab: React.FC<BlockedEmailsTabProps> = ({ currentUser, onShowToast }) => {
  const [blockedList, setBlockedList] = useState<BlockedDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New block input
  const [newEmail, setNewEmail] = useState<string>('');
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  // Unblock confirmation
  const [unblockTarget, setUnblockTarget] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated: token unavailable');

      const raw = await listCollectionDocs({
        projectId: firebaseConfig.projectId,
        databaseId: firebaseConfig.firestoreDatabaseId,
        collection: 'blocked',
        token,
      });

      const list: BlockedDoc[] = raw.map((d: any) => ({
        email: (d.email || d.__id || '').trim().toLowerCase(),
        blockedBy: (d.blockedBy || '').trim().toLowerCase(),
        blockedAt: d.blockedAt || '',
      }));
      setBlockedList(list);
    } catch (err: any) {
      console.warn('Failed to load blocked list:', err);
      const rawMsg = err?.message || String(err);
      setErrorMsg(`Could not load blocked emails: ${rawMsg.slice(0, 300)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToBlock = newEmail.trim().toLowerCase();
    if (!emailToBlock) return;

    if (emailToBlock === MAIN_ADMIN_EMAIL.toLowerCase()) {
      setErrorMsg('Cannot block the Main Admin anchor.');
      return;
    }

    if (!emailToBlock.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setActionInProgress(true);
    setErrorMsg(null);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated');

      const res = await blockEmail(token, emailToBlock, currentUser.email);
      if (res.success) {
        onShowToast(`Blocked ${emailToBlock}`);
        setNewEmail('');
        await loadData();
      } else {
        setErrorMsg(`Failed to block email (HTTP ${res.status}): ${res.error || 'Permission denied'}`);
      }
    } catch (err: any) {
      setErrorMsg(`Block failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleUnblock = async (emailToUnblock: string) => {
    setActionInProgress(true);
    setErrorMsg(null);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated');

      const res = await unblockEmail(token, emailToUnblock);
      if (res.success) {
        onShowToast(`Unblocked ${emailToUnblock}`);
        setUnblockTarget(null);
        await loadData();
      } else {
        setErrorMsg(`Failed to unblock email (HTTP ${res.status}): ${res.error || 'Permission denied'}`);
      }
    } catch (err: any) {
      setErrorMsg(`Unblock failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[var(--panel-2)] p-4 rounded-xl border border-[var(--line)]">
        <div>
          <h3 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <Ban className="w-5 h-5 text-[var(--red)]" />
            Blocked Company Emails (Main Admin Only)
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Use this for employees who left the company (offboarding). A blocked company email loses all access immediately.
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="btn ghost !p-2 flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-[var(--red-dim)] border border-[var(--red)] text-[var(--red)] rounded-xl text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 font-mono">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="font-bold px-1">✕</button>
        </div>
      )}

      {/* Block new email form */}
      <div className="bg-[var(--panel)] border border-[var(--line)] rounded-xl p-4 space-y-3">
        <h4 className="text-xs font-bold text-[var(--muted-2)] uppercase tracking-wider flex items-center gap-1.5">
          <UserX className="w-3.5 h-3.5 text-[var(--red)]" />
          Block An Email
        </h4>

        <form onSubmit={handleBlock} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            placeholder="e.g. departed.agent@breadfast.com"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            disabled={actionInProgress}
            className="flex-1 px-3 py-2 bg-[var(--panel-2)] border border-[var(--line)] rounded-lg text-xs text-[var(--text)] placeholder-[var(--muted-2)] font-mono"
            required
          />
          <button
            type="submit"
            disabled={actionInProgress || !newEmail.trim()}
            className="btn !bg-[var(--red)] text-white hover:opacity-90 font-bold text-xs flex items-center justify-center gap-1.5 px-4"
          >
            <Ban className="w-3.5 h-3.5" />
            <span>{actionInProgress ? 'Blocking...' : 'Block Email'}</span>
          </button>
        </form>
      </div>

      {/* Table of Blocked emails */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--muted-2)] uppercase tracking-wider">
          Currently Blocked Accounts ({blockedList.length})
        </h4>

        <div className="overflow-x-auto border border-[var(--line)] rounded-xl bg-[var(--panel)]">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--panel-2)] border-b border-[var(--line)] text-[var(--muted)] uppercase font-mono text-[10px]">
              <tr>
                <th className="p-3">Blocked Email</th>
                <th className="p-3">Blocked By</th>
                <th className="p-3">Blocked On</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {blockedList.map(item => (
                <tr key={item.email} className="hover:bg-[var(--panel-2)]/50 transition-colors">
                  <td className="p-3 font-semibold text-[var(--text)] font-mono flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-[var(--red)]" />
                    {item.email}
                  </td>
                  <td className="p-3 text-[var(--muted)] text-[11px] font-mono">{item.blockedBy}</td>
                  <td className="p-3 text-[var(--muted-2)] text-[11px]">
                    {item.blockedAt ? new Date(item.blockedAt).toLocaleString() : '—'}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => setUnblockTarget(item.email)}
                      disabled={actionInProgress}
                      className="btn ghost !py-1 !px-2 text-xs text-[var(--green)] hover:bg-[var(--green)]/10 rounded font-semibold"
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}

              {blockedList.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-[var(--muted)] italic text-xs">
                    No accounts currently blocked.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unblock Confirmation Modal */}
      {unblockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h4 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-[var(--green)]" />
              Confirm Unblock
            </h4>

            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Are you sure you want to unblock{' '}
              <strong className="text-[var(--text)] font-mono">{unblockTarget}</strong>?
              If this is a valid @breadfast.com account, they will regain access to read the KB upon sign-in.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
              <button
                disabled={actionInProgress}
                onClick={() => setUnblockTarget(null)}
                className="btn ghost text-xs"
              >
                Cancel
              </button>
              <button
                disabled={actionInProgress}
                onClick={() => handleUnblock(unblockTarget)}
                className="btn primary text-xs font-bold"
              >
                {actionInProgress ? 'Unblocking...' : 'Confirm Unblock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
