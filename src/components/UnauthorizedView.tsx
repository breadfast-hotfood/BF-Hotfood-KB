import React from 'react';
import { ShieldAlert, LogOut, Lock, Ban } from 'lucide-react';

interface UnauthorizedViewProps {
  email: string;
  name?: string;
  reason?: 'unauthorized_domain' | 'blocked' | 'unlisted' | string;
  onSignOut: () => void;
}

export const UnauthorizedView: React.FC<UnauthorizedViewProps> = ({ email, name, reason, onSignOut }) => {
  const isBlocked = reason === 'blocked';

  return (
    <div className="min-h-[calc(100vh-57px)] flex items-center justify-center p-6 bg-[var(--bg)]">
      <div className="max-w-md w-full bg-[var(--panel)] border border-[var(--line)] rounded-2xl p-8 shadow-xl text-center flex flex-col items-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--red-dim)] flex items-center justify-center text-[var(--red)] mb-5">
          {isBlocked ? <Ban className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider bg-[var(--panel-2)] border border-[var(--line)] text-[var(--muted)] mb-3">
          <Lock className="w-3 h-3" />
          {isBlocked ? 'Access Disabled' : 'Restricted Domain'}
        </div>

        <h2 className="text-xl font-bold text-[var(--text)] mb-2">
          {isBlocked ? 'Access has been disabled' : 'Access restricted to @breadfast.com accounts'}
        </h2>

        <p className="text-sm text-[var(--muted)] mb-5 leading-relaxed">
          {isBlocked ? (
            <>
              Your access has been disabled, contact the Main Admin. Account:{' '}
              <strong className="text-[var(--text)] font-semibold font-mono">{email}</strong>.
            </>
          ) : (
            <>
              You have signed in with{' '}
              <strong className="text-[var(--text)] font-semibold font-mono">{email}</strong>.
              Only verified company accounts ending with <strong>@breadfast.com</strong> are permitted to access the Knowledge Base.
            </>
          )}
        </p>

        <div className="w-full bg-[var(--panel-2)] border border-[var(--line)] rounded-xl p-4 text-xs text-[var(--muted)] text-start mb-6 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-[var(--text)]">
            <span>What to do:</span>
          </div>
          <ul className="list-disc list-inside space-y-1">
            {isBlocked ? (
              <>
                <li>This company account is currently listed in the blocked offboarding registry.</li>
                <li>If you believe this is an error, reach out directly to the Main Admin.</li>
              </>
            ) : (
              <>
                <li>Sign out and select your official <code>@breadfast.com</code> Google Workspace account.</li>
                <li>Non-company Google accounts cannot view or interact with Knowledge Base data.</li>
              </>
            )}
          </ul>
        </div>

        <button
          onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-[var(--panel-2)] hover:bg-[var(--line)] border border-[var(--line)] text-[var(--text)] transition-colors"
        >
          <LogOut className="w-4 h-4 text-[var(--muted)]" />
          Sign out of Google
        </button>
      </div>
    </div>
  );
};
