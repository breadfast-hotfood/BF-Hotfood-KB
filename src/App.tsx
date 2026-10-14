import React, { useEffect, useState, useMemo } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider, testConnection } from './firebase';
import { AuthUser, AuthStatus, Workbook, Tab, RecordItem, SearchResult } from './types';
import { UnauthorizedView } from './components/UnauthorizedView';
import { UnauthenticatedView } from './components/UnauthenticatedView';
import { Drawer } from './components/Drawer';
import { NotesModal } from './components/NotesModal';
import { TableView } from './components/TableView';
import { AdminPanel } from './components/AdminPanel';
import { registerOrUpdateMember } from './utils/adminManagementRest';
import { defaultSearchScope } from './utils/searchScope';
import {
  splitHeader,
  isCritical,
  recordDisplayTitle,
  descValue,
  searchRecords,
  tableRowMatches,
  primaryValue,
  normalize,
  esc,
} from './utils/kbUtils';
import {
  Search,
  Sun,
  Moon,
  BookOpen,
  LogOut,
  FolderOpen,
  Check,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

const THEME_KEY = 'kb-theme';
const BOOTSTRAP_EMAIL = 'breadfast.hotfood@gmail.com';

export default function App() {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {}
    return 'light';
  });

  // Auth state
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [unauthorizedEmail, setUnauthorizedEmail] = useState<string>('');
  const [unauthorizedReason, setUnauthorizedReason] = useState<string>('unauthorized_domain');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);

  // Admin Modal
  const [adminPanelOpen, setAdminPanelOpen] = useState<boolean>(false);

  // KB data state
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [activeTabIdx, setActiveTabIdx] = useState<number>(0);
  const [kbLoading, setKbLoading] = useState<boolean>(false);

  // Interactive filtering state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scopeField, setScopeField] = useState<string>('ALL');
  const [userTabScopes, setUserTabScopes] = useState<Record<number, string>>({});
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [activeComplaintType, setActiveComplaintType] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [openRecord, setOpenRecord] = useState<RecordItem | null>(null);
  const [notesOpen, setNotesOpen] = useState<boolean>(false);

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(current => (current === msg ? null : current));
    }, 2500);
  };

  // Test connection to Firestore on boot as required by skill
  useEffect(() => {
    testConnection();
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      setAuthError(null);
      if (!fbUser) {
        setAuthStatus('unauthenticated');
        setCurrentUser(null);
        setWorkbook(null);
        (window as any).__getAuthToken = null;
        return;
      }

      (window as any).__getAuthToken = () => fbUser.getIdToken();

      try {
        const idToken = await fbUser.getIdToken();

        // 1. Verify caller session with trusted server
        const res = await fetch('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        const data = await res.json();
        const email = (fbUser.email || '').trim().toLowerCase();

        // If designated Main Admin, ensure bootstrap is executed via trusted server Admin SDK
        if (email === BOOTSTRAP_EMAIL.toLowerCase()) {
          try {
            await fetch('/api/auth/bootstrap', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${idToken}`,
                'Content-Type': 'application/json',
              },
            });
          } catch (err) {
            console.warn('[SERVER BOOTSTRAP NOTICE]', err);
          }
        }

        if (data.authorized && data.user) {
          setCurrentUser(data.user);
          setAuthStatus('authorized');

          // Automatic member self-registration for company users
          if (email.endsWith('@breadfast.com')) {
            registerOrUpdateMember(idToken, email, data.user.name || fbUser.displayName || 'Breadfast Employee')
              .catch(e => console.warn('Member registration notice:', e));
          }

          // 2. Fetch active KB via authorized endpoint
          setKbLoading(true);
          try {
            const kbRes = await fetch('/api/kb/active', {
              headers: { Authorization: `Bearer ${idToken}` },
            });
            if (kbRes.ok) {
              const kbData = await kbRes.json();
              setWorkbook({
                tabs: kbData.tabs,
                fileName: kbData.fileName,
                versionId: kbData.versionId,
                isSample: !!kbData.isSample,
              });
              const defIdx = kbData.tabs.findIndex((t: Tab) => /customer\s*complaints?/i.test(t.name));
              setActiveTabIdx(defIdx >= 0 ? defIdx : 0);
            }
          } catch (e) {
            console.error('KB fetch error:', e);
          } finally {
            setKbLoading(false);
          }
        } else {
          setAuthStatus('unauthorized');
          setUnauthorizedEmail(data.email || fbUser.email || '');
          setUnauthorizedReason(data.reason || 'unauthorized_domain');
          setCurrentUser(null);
          setWorkbook(null);
        }
      } catch (err: any) {
        console.error('Session verification error:', err);
        setAuthStatus('unauthorized');
        setUnauthorizedEmail(fbUser.email || '');
        setUnauthorizedReason('unauthorized_domain');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setAuthError(err.message || 'Failed to sign in with Google');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setAuthStatus('unauthenticated');
      setCurrentUser(null);
      setWorkbook(null);
    } catch (err: any) {
      console.error('Sign-out error:', err);
    }
  };

  // Active tab derived values
  const activeTab = useMemo<Tab | null>(() => {
    if (!workbook || !workbook.tabs[activeTabIdx]) return null;
    return workbook.tabs[activeTabIdx];
  }, [workbook, activeTabIdx]);

  const activeKB = activeTab?.kb || null;
  const tabIsTable = activeTab ? (activeTab.kind !== 'cases' || activeTab.view === 'table') : false;

  // Apply default search scope ("Complaint Type") or user's saved choice per tab
  useEffect(() => {
    if (!activeTab) return;
    if (userTabScopes[activeTabIdx] !== undefined) {
      setScopeField(userTabScopes[activeTabIdx]);
      return;
    }
    const defKey = defaultSearchScope(activeTab);
    if (defKey && activeTab.kb?.fieldOrder) {
      const idx = activeTab.kb.fieldOrder.findIndex(f => f.key === defKey);
      if (idx !== -1) {
        setScopeField(String(idx));
        return;
      }
    }
    setScopeField('ALL');
  }, [activeTab, activeTabIdx, userTabScopes]);

  // Filtered search records
  const searchResults: SearchResult[] = useMemo(() => {
    if (!activeKB || tabIsTable) return [];
    return searchRecords(activeKB, searchQuery, scopeField, activeSection, activeComplaintType);
  }, [activeKB, tabIsTable, searchQuery, scopeField, activeSection, activeComplaintType]);

  // Table matches count
  const tableMatchesCount = useMemo(() => {
    if (!activeTab || !tabIsTable) return 0;
    return tableRowMatches(activeTab, searchQuery).length;
  }, [activeTab, tabIsTable, searchQuery]);

  // Distinct category sections
  const sectionsList = useMemo(() => {
    if (!activeKB) return [];
    const seen: Record<string, boolean> = {};
    const list: string[] = [];
    activeKB.records.forEach(r => {
      if (!seen[r._section]) {
        seen[r._section] = true;
        list.push(r._section);
      }
    });
    return list;
  }, [activeKB]);

  const complaintTypesFor = (section: string) => {
    if (!activeKB) return [];
    const seen: Record<string, boolean> = {};
    const out: string[] = [];
    activeKB.records.forEach(r => {
      if (r._section === section) {
        const ct = primaryValue(r, activeKB);
        if (ct && !seen[ct]) {
          seen[ct] = true;
          out.push(ct);
        }
      }
    });
    return out;
  };

  const toggleSection = (sec: string) => {
    setExpandedSections(prev => ({ ...prev, [sec]: !prev[sec] }));
    if (activeSection === sec && !activeComplaintType) {
      setActiveSection(null);
    } else {
      setActiveSection(sec);
      setActiveComplaintType(null);
    }
  };

  const selectComplaintType = (sec: string, ct: string) => {
    setActiveSection(sec);
    setActiveComplaintType(prev => (prev === ct ? null : ct));
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q) return esc(text);
    const norm = normalize(text);
    const nq = normalize(q);
    let out = '';
    let i = 0;
    while (true) {
      const idx = norm.indexOf(nq, i);
      if (idx === -1) {
        out += esc(text.slice(i));
        break;
      }
      out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + nq.length)) + '</mark>';
      i = idx + nq.length;
    }
    return out;
  };

  // Top bar component
  const renderTopBar = () => {
    const count = tabIsTable ? tableMatchesCount : searchResults.length;
    const isAdminUser = currentUser?.role === 'Admin' || currentUser?.role === 'Main Admin';

    return (
      <header className="topbar">
        {/* Brand */}
        <div className="brand">
          <div className="brand-mark">CX</div>
          <div className="brand-text">
            <div className="flex items-center gap-2">
              <b>Breadfast KB</b>
              {workbook?.isSample && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 whitespace-nowrap">
                  Sample data - not a published version
                </span>
              )}
            </div>
            <span>CASE REFERENCE</span>
          </div>
        </div>

        {/* Search Bar */}
        {authStatus === 'authorized' && activeKB && (
          <div className="search-wrap">
            <div className="search-box">
              <Search className="w-4 h-4 text-[var(--muted-2)] shrink-0" />
              <input
                id="searchInput"
                type="text"
                placeholder="Search cases, scripts, refund rules, SLAs…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn ghost !p-1 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Scope select */}
            {!tabIsTable && (
              <select
                className="scope-select"
                value={scopeField}
                onChange={e => {
                  const val = e.target.value;
                  setUserTabScopes(prev => ({ ...prev, [activeTabIdx]: val }));
                  setScopeField(val);
                }}
              >
                <option value="ALL">All fields</option>
                {activeKB.fieldOrder.map((f, i) => (
                  <option key={f.key} value={String(i)}>
                    {splitHeader(f.key).en}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Match Count Pill */}
        {authStatus === 'authorized' && activeKB && (
          <div className="count-pill">
            {count} {count === 1 ? 'match' : 'matches'}
          </div>
        )}

        {/* Action Controls */}
        <div className="topbar-actions">
          {/* Admin Center Button (Visible only to Admin / Main Admin) */}
          {authStatus === 'authorized' && isAdminUser && (
            <button
              onClick={() => setAdminPanelOpen(true)}
              className="btn primary text-xs !py-1.5 !px-3 font-bold"
              title="Open Administration Center"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin Center</span>
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="btn ghost !p-2 rounded-lg"
            title="Switch light / dark theme"
            aria-label="Switch theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Important Notes */}
          {authStatus === 'authorized' && activeKB && activeKB.importantNotes.length > 0 && (
            <button
              onClick={() => setNotesOpen(true)}
              className="btn ghost"
              title="View important notes for this sheet"
            >
              <BookOpen className="w-4 h-4" />
              <span>Notes</span>
            </button>
          )}

          {/* User Profile & Sign Out */}
          {authStatus === 'authorized' && currentUser && (
            <div className="flex items-center gap-2 pl-2 border-l border-[var(--line)]">
              <div className="hidden sm:flex flex-col text-right leading-tight">
                <span className="font-bold text-xs text-[var(--text)] truncate max-w-[140px]">
                  {currentUser.name || currentUser.email}
                </span>
                <span className={`text-[9px] font-mono uppercase font-bold tracking-wider ${
                  currentUser.role === 'Main Admin'
                    ? 'text-amber-600 dark:text-amber-400'
                    : currentUser.role === 'Admin'
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted-2)]'
                }`}>
                  {currentUser.role}
                </span>
              </div>
              <button
                onClick={handleSignOut}
                className="btn ghost text-xs text-[var(--muted)] hover:text-[var(--red)]"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>
    );
  };

  // Render based on Authentication State
  if (authStatus === 'loading') {
    return (
      <div className="app-root">
        {renderTopBar()}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-[var(--muted)]">
          <div className="w-10 h-10 border-3 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium">Verifying access authorization...</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return (
      <div className="app-root">
        {renderTopBar()}
        <UnauthenticatedView
          onSignIn={handleSignIn}
          isLoading={isSigningIn}
          errorMessage={authError}
        />
      </div>
    );
  }

  if (authStatus === 'unauthorized') {
    return (
      <div className="app-root">
        {renderTopBar()}
        <UnauthorizedView
          email={unauthorizedEmail}
          name={currentUser?.name}
          reason={unauthorizedReason}
          onSignOut={handleSignOut}
        />
      </div>
    );
  }

  // Authorized state: Full KB rendering
  return (
    <div className="app-root">
      {renderTopBar()}

      {/* Tabs Bar */}
      {workbook && workbook.tabs.length > 0 && (
        <div className="tabbar" role="tablist">
          {workbook.tabs.map((tab, idx) => (
            <button
              key={idx}
              className={`tab ${idx === activeTabIdx ? 'active' : ''}`}
              onClick={() => {
                setActiveTabIdx(idx);
                setActiveSection(null);
                setActiveComplaintType(null);
                setExpandedSections({});
                setOpenRecord(null);
              }}
              role="tab"
              aria-selected={idx === activeTabIdx}
            >
              {tab.name.trim() || `Sheet ${idx + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Body Layout */}
      <div className="body-layout">
        {/* Sidebar (shown only for cases tabs) */}
        {!tabIsTable && activeKB && (
          <aside className="sidebar">
            <div className="sidebar-title">Categories</div>
            {sectionsList.map(sec => {
              const count = activeKB.records.filter(r => r._section === sec).length;
              const isOpen = Boolean(expandedSections[sec]);
              const crit = isCritical(sec);
              const isActiveSec = activeSection === sec;

              return (
                <div key={sec} className="sec">
                  <button
                    className={`sec-head ${isActiveSec ? 'active' : ''}`}
                    onClick={() => toggleSection(sec)}
                  >
                    <span className={`sec-stripe ${crit ? 'critical' : ''}`} />
                    <ChevronRight
                      className={`chev ${isOpen ? 'open' : ''} w-3 h-3`}
                    />
                    <span className="sec-name">{sec || 'General Cases'}</span>
                    <span className="sec-count">{count}</span>
                  </button>

                  {isOpen && (
                    <div className="sub-list">
                      {complaintTypesFor(sec).map(ct => {
                        const isCtActive = activeComplaintType === ct && isActiveSec;
                        return (
                          <button
                            key={ct}
                            className={`sub-item ${isCtActive ? 'active' : ''}`}
                            onClick={() => selectComplaintType(sec, ct)}
                          >
                            {ct}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {activeKB.importantNotes.length > 0 && (
              <div className="mt-4 pt-3 border-t border-[var(--line)]">
                <button className="notes-btn" onClick={() => setNotesOpen(true)}>
                  💡 Important Notes
                </button>
              </div>
            )}
          </aside>
        )}

        {/* Main Content Area */}
        <main className="main-content">
          {kbLoading && (
            <div className="text-center py-12 text-[var(--muted)]">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs">Loading knowledge base records...</p>
            </div>
          )}

          {!kbLoading && activeTab && (
            <>
              {/* View Switcher for cases tab */}
              {activeTab.kind === 'cases' && (
                <div className="viewsw">
                  <button
                    className={activeTab.view !== 'table' ? 'on' : ''}
                    onClick={() => {
                      activeTab.view = 'smart';
                      setActiveSection(null);
                      setActiveComplaintType(null);
                      setWorkbook({ ...workbook! });
                    }}
                  >
                    Cards
                  </button>
                  <button
                    className={activeTab.view === 'table' ? 'on' : ''}
                    onClick={() => {
                      activeTab.view = 'table';
                      setActiveSection(null);
                      setActiveComplaintType(null);
                      setWorkbook({ ...workbook! });
                    }}
                  >
                    Table
                  </button>
                </div>
              )}

              {/* Table View Rendering */}
              {tabIsTable ? (
                <TableView
                  tab={activeTab}
                  query={searchQuery}
                  onActivateTabByName={targetName => {
                    const idx = workbook?.tabs.findIndex(
                      t => t.name.trim().toLowerCase() === targetName.trim().toLowerCase()
                    );
                    if (idx !== undefined && idx >= 0) setActiveTabIdx(idx);
                  }}
                />
              ) : (
                /* Cards View Rendering */
                <div>
                  {/* Active Filter Chips */}
                  {(activeSection || activeComplaintType) && (
                    <div className="active-filters">
                      {activeSection && (
                        <div className="filter-chip">
                          <span>{activeSection}</span>
                          <button
                            onClick={() => {
                              setActiveSection(null);
                              setActiveComplaintType(null);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      {activeComplaintType && (
                        <div className="filter-chip">
                          <span>{activeComplaintType}</span>
                          <button onClick={() => setActiveComplaintType(null)}>✕</button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty search results */}
                  {searchResults.length === 0 ? (
                    <div className="text-center py-16 text-[var(--muted)]">
                      <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
                      <h2 className="text-base font-bold text-[var(--text)] mb-1">No matching cases</h2>
                      <p className="text-xs">Try different search keywords or clear the category filter.</p>
                    </div>
                  ) : (
                    /* Cards Grid */
                    <div className="cards-grid">
                      {searchResults.map(item => {
                        const rec = item.rec;
                        const crit = isCritical(rec._section);
                        const title = recordDisplayTitle(rec, activeKB);
                        const desc = descValue(rec, activeKB);

                        return (
                          <button
                            key={rec._row}
                            className={`card ${crit ? 'critical' : ''}`}
                            onClick={() => setOpenRecord(rec)}
                          >
                            <div className="card-top">
                              <span className="card-section">
                                {rec._section.replace(/\s*\(Critical\)/i, '') || 'General'}
                              </span>
                              <span className="card-tag">#{String(rec._row).padStart(3, '0')}</span>
                            </div>

                            <div className="card-title">{title}</div>

                            {desc && <div className="card-desc">{desc}</div>}

                            {item.matchKey && (
                              <div className="card-match">
                                <b>{splitHeader(item.matchKey).en}</b>
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: highlightMatch(item.snippet || '', searchQuery),
                                  }}
                                />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Case Details Drawer */}
      <Drawer
        record={openRecord}
        kb={activeKB}
        onClose={() => setOpenRecord(null)}
        onShowToast={showToast}
      />

      {/* Important Notes Modal */}
      <NotesModal
        isOpen={notesOpen}
        notes={activeKB?.importantNotes || []}
        onClose={() => setNotesOpen(false)}
      />

      {/* Admin Panel Modal */}
      {currentUser && adminPanelOpen && (
        <AdminPanel
          currentUser={currentUser}
          onClose={() => setAdminPanelOpen(false)}
          onShowToast={showToast}
          onWorkbookUpdated={(updatedWb) => {
            setWorkbook(updatedWb);
            setActiveTabIdx(0);
            setActiveSection(null);
            setActiveComplaintType(null);
          }}
        />
      )}

      {/* Toast notification */}
      {toastMessage && (
        <div className="toast show" role="status">
          <Check className="w-4 h-4 text-[var(--green)]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
