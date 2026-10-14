import React from 'react';
import { isRTLText, linkify, esc } from '../utils/kbUtils';

interface NotesModalProps {
  isOpen: boolean;
  notes: string[];
  onClose: () => void;
}

export const NotesModal: React.FC<NotesModalProps> = ({ isOpen, notes, onClose }) => {
  if (!isOpen) return null;

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <div className="modal show" role="dialog" aria-modal="true">
        <div className="modal-card">
          <div className="modal-head">
            <h3 className="font-bold text-base text-[var(--text)]">💡 Important Notes</h3>
            <button
              className="drawer-close ml-auto"
              onClick={onClose}
              aria-label="Close notes modal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="modal-body">
            {notes.length === 0 ? (
              <div className="text-center py-8 text-[var(--muted)] text-sm">
                No special notes recorded for this tab.
              </div>
            ) : (
              notes.map((note, idx) => {
                const rtl = isRTLText(note);
                return (
                  <div
                    key={idx}
                    className="note-block"
                    dir={rtl ? 'rtl' : 'auto'}
                    dangerouslySetInnerHTML={{ __html: linkify(esc(note)) }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
};
