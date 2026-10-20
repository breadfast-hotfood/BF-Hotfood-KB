import React, { useState, useEffect } from 'react';
import { AuthUser } from '../types';
import { MemberDoc, AdminDoc } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';
import { listCollectionDocs } from '../utils/firestoreList';
import {
  grantAdmin,
  revokeAdmin,
} from '../utils/adminManagementRest';
import { MAIN_ADMIN_EMAIL } from '../utils/accessPayloads';
import { useBackdropClose } from '../utils/backdropClose';
import {
  ShieldCheck,
  UserCheck,
  Trash2,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Crown,
} from 'lucide-react';

interface AdminsTabProps {
  currentUser: AuthUser;
  onShowToast: (msg: string) => void;
}

export const AdminsTab: React.FC<AdminsTabProps> = ({ currentUser, onShowToast }) => {
  const isMainAdmin = currentUser.role === 'Main Admin';
  const [admins, setAdmins] = useState<AdminDoc[]>([]);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Confirmation dialog state
  const [confirmModal, setConfirmModal] = useState<{
    type: 'grant' | 'revoke';
    targetEmail: string;
    targetName?: string;
  } | null>(null);
  const [actionInProgress, setActionInProgress] = useState<boolean>(false);

  const confirmBackdrop = useBackdropClose(() => setConfirmModal(null));

  const loadData = async (silent: boolean | React.MouseEvent = false) => {
    const quiet = silent === true;
    if (!quiet) setLoading(true);
    setErrorMsg(null);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated: token unavailable');

      const [adminsRaw, membersRaw] = await Promise.all([
        listCollectionDocs({
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          collection: 'admins',
          token,
        }),
        listCollectionDocs({
          projectId: firebaseConfig.projectId,
          databaseId: firebaseConfig.firestoreDatabaseId,
          collection: 'members',
          token,
        }),
      ]);

      const adminsList: AdminDoc[] = adminsRaw.map((d: any) => ({
        email: (d.email || d.__id || '').trim().toLowerCase(),
        grantedBy: (d.grantedBy || '').trim().toLowerCase(),
        grantedAt: d.grantedAt || '',
      }));

      const membersList: MemberDoc[] = membersRaw.map((d: any) => ({
        email: (d.email || d.__id || '').trim().toLowerCase(),
        name: d.name || '',
        firstSeenAt: d.firstSeenAt || '',
        lastSeenAt: d.lastSeenAt || '',
      })).sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

      setAdmins(adminsList);
      setMembers(membersList);
    } catch (err: any) {
      console.warn('Failed to load Admins & Members data:', err);
      const rawMsg = err?.message || String(err);
      setErrorMsg(`Could not load admins or members: ${rawMsg.slice(0, 300)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Keep the lists fresh when the user comes back to this window (no manual refresh needed)
    const onVisible = () => { if (document.visibilityState === 'visible') void loadData(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleGrant = async (targetEmail: string) => {
    setActionInProgress(true);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated');

      const res = await grantAdmin(token, targetEmail, currentUser.email);
      if (res.success) {
        onShowToast(`Granted Admin to ${targetEmail}`);
        setConfirmModal(null);
        await loadData();
      } else {
        setErrorMsg(`Failed to grant Admin (HTTP ${res.status}): ${res.error || 'Permission denied'}`);
      }
    } catch (err: any) {
      setErrorMsg(`Grant failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRevoke = async (targetEmail: string) => {
    setActionInProgress(true);
    try {
      const token = await (window as any).__getAuthToken?.();
      if (!token) throw new Error('Not authenticated');

      const res = await revokeAdmin(token, targetEmail);
      if (res.success) {
        onShowToast(`Revoked Admin from ${targetEmail}`);
        setConfirmModal(null);
        await loadData();
      } else {
        setErrorMsg(`Failed to revoke Admin (HTTP ${res.status}): ${res.error || 'Permission denied'}`);
      }
    } catch (err: any) {
      setErrorMsg(`Revoke failed: ${err.message}`);
    } finally {
      setActionInProgress(false);
    }
  };

  // Helper map for member names
  const memberNameMap = new Map<string, string>();
  for (const m of members) {
    if (m.name) memberNameMap.set(m.email.toLowerCase(), m.name);
  }

  // Filtered members list
  const filteredMembers = members.filter(m => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return m.email.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
  });

  const adminEmailSet = new Set(admins.map(a => a.email.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[var(--panel-2)] p-4 rounded-xl border border-[var(--line)]">
        <div>
          <h3 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--accent)]" />
            Admins & Access Control
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Anyone signing in with verified @breadfast.com Google account has read access to the KB.
            Manage elevated Admin privileges below.
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

      {/* Table 1: Current Admins */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--muted-2)] uppercase tracking-wider">
          Current Administrators
        </h4>

        <div className="overflow-x-auto border border-[var(--line)] rounded-xl bg-[var(--panel)]">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--panel-2)] border-b border-[var(--line)] text-[var(--muted)] uppercase font-mono text-[10px]">
              <tr>
                <th className="p-3">Role</th>
                <th className="p-3">Email</th>
                <th className="p-3">Name</th>
                <th className="p-3">Granted By</th>
                <th className="p-3">Granted On</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {/* Fixed row: Main Admin */}
              <tr className="bg-amber-500/5">
                <td className="p-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Crown className="w-3 h-3" />
                    MAIN ADMIN
                  </span>
                </td>
                <td className="p-3 font-semibold text-[var(--text)]">{MAIN_ADMIN_EMAIL}</td>
                <td className="p-3 text-[var(--muted)]">Primary Anchor</td>
                <td className="p-3 text-[var(--muted-2)]">System Anchor</td>
                <td className="p-3 text-[var(--muted-2)]">Permanent</td>
                <td className="p-3 text-right text-[var(--muted-2)] italic text-[11px]">
                  Protected
                </td>
              </tr>

              {/* Company Admins */}
              {admins.map(admin => {
                const isSelf = admin.email.toLowerCase() === currentUser.email.toLowerCase();
                // A company admin cannot remove self unless Main Admin; Main Admin can revoke anyone
                const canRemove = isMainAdmin || !isSelf;

                return (
                  <tr key={admin.email} className="hover:bg-[var(--panel-2)]/50 transition-colors">
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                        <ShieldCheck className="w-3 h-3" />
                        ADMIN
                      </span>
                    </td>
                    <td className="p-3 font-medium text-[var(--text)]">{admin.email}</td>
                    <td className="p-3 text-[var(--muted)]">
                      {memberNameMap.get(admin.email.toLowerCase()) || '—'}
                    </td>
                    <td className="p-3 text-[var(--muted)] text-[11px] font-mono">{admin.grantedBy}</td>
                    <td className="p-3 text-[var(--muted-2)] text-[11px]">
                      {admin.grantedAt ? new Date(admin.grantedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {canRemove ? (
                        <button
                          onClick={() => setConfirmModal({ type: 'revoke', targetEmail: admin.email, targetName: memberNameMap.get(admin.email.toLowerCase()) })}
                          className="btn ghost !py-1 !px-2 text-xs text-[var(--red)] hover:bg-[var(--red-dim)] rounded"
                          title="Revoke Admin privileges"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      ) : (
                        <span className="text-[var(--muted-2)] italic text-[11px]">Current user</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {admins.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-[var(--muted)] italic text-xs">
                    No additional company administrators granted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 2: People Who Signed In */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-[var(--muted-2)] uppercase tracking-wider">
              People Who Signed In (From members collection)
            </h4>
            <p className="text-xs text-[var(--muted)]">
              Automatically populated when company employees sign in. Promote team leads to Admin here.
            </p>
          </div>
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[var(--panel-2)] border border-[var(--line)] rounded-lg text-xs text-[var(--text)] placeholder-[var(--muted-2)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-[var(--line)] rounded-xl bg-[var(--panel)]">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--panel-2)] border-b border-[var(--line)] text-[var(--muted)] uppercase font-mono text-[10px]">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">First Seen</th>
                <th className="p-3">Last Seen</th>
                <th className="p-3 text-right">Status / Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredMembers.map(member => {
                const isAdminUser = adminEmailSet.has(member.email.toLowerCase());

                return (
                  <tr key={member.email} className="hover:bg-[var(--panel-2)]/50 transition-colors">
                    <td className="p-3 font-semibold text-[var(--text)]">{member.name || 'Breadfast Employee'}</td>
                    <td className="p-3 text-[var(--muted)] font-mono text-[11px]">{member.email}</td>
                    <td className="p-3 text-[var(--muted-2)] text-[11px]">
                      {member.firstSeenAt ? new Date(member.firstSeenAt).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-[var(--muted-2)] text-[11px]">
                      {member.lastSeenAt ? new Date(member.lastSeenAt).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {isAdminUser ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Admin
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmModal({ type: 'grant', targetEmail: member.email, targetName: member.name })}
                          className="btn ghost !py-1 !px-2 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded font-semibold"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Make Admin</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-[var(--muted)] italic text-xs">
                    {members.length === 0
                      ? 'No members registered yet. Company users register automatically upon first sign-in.'
                      : 'No users matching your search query.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Dialog Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" {...confirmBackdrop}>
          <div className="bg-[var(--panel)] border border-[var(--line)] rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <h4 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
              {confirmModal.type === 'grant' ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
                  Confirm Admin Grant
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 text-[var(--red)]" />
                  Confirm Admin Revocation
                </>
              )}
            </h4>

            <p className="text-xs text-[var(--muted)] leading-relaxed">
              {confirmModal.type === 'grant' ? (
                <>
                  Are you sure you want to promote{' '}
                  <strong className="text-[var(--text)]">{confirmModal.targetEmail}</strong>{' '}
                  to Admin? They will be able to publish KB versions, manage other Admins, and view signed-in members.
                </>
              ) : (
                <>
                  Are you sure you want to revoke Admin rights from{' '}
                  <strong className="text-[var(--text)]">{confirmModal.targetEmail}</strong>?
                  They will revert to regular company user access (read-only KB).
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
              <button
                disabled={actionInProgress}
                onClick={() => setConfirmModal(null)}
                className="btn ghost text-xs"
              >
                Cancel
              </button>
              <button
                disabled={actionInProgress}
                onClick={() => {
                  if (confirmModal.type === 'grant') handleGrant(confirmModal.targetEmail);
                  else handleRevoke(confirmModal.targetEmail);
                }}
                className={`btn text-xs font-bold ${
                  confirmModal.type === 'grant' ? 'primary' : '!bg-[var(--red)] text-white hover:opacity-90'
                }`}
              >
                {actionInProgress ? 'Processing...' : confirmModal.type === 'grant' ? 'Confirm Make Admin' : 'Confirm Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
