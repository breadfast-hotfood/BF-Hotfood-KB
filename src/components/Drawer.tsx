import React, { useState } from 'react';
import { RecordItem, KBData, FieldOrder } from '../types';
import {
  splitHeader,
  isCritical,
  recordDisplayTitle,
  descValue,
  isRTLText,
  linkify,
  esc,
} from '../utils/kbUtils';

interface DrawerProps {
  record: RecordItem | null;
  kb: KBData | null;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

export const Drawer: React.FC<DrawerProps> = ({ record, kb, onClose, onShowToast }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!record || !kb) return null;

  const crit = isCritical(record._section);
  const title = recordDisplayTitle(record, kb);
  const desc = descValue(record, kb);

  // Group and prioritize fields matching breadfast-kb.html
  const orderedFields = kb.fieldOrder.filter(f => {
    const k = f.key.toLowerCase();
    return f.key !== kb.primaryKey && f.key !== kb.descKey && !k.startsWith('category');
  });

  const priorityPatterns = [
    /^refund needed/i,
    /^compensation needed/i,
    /^product image/i,
    /^cost accountability/i,
    /^chat label/i,
    /^ticket tree/i,
  ];

  const priorityKeys: FieldOrder[] = [];
  priorityPatterns.forEach(re => {
    const match = orderedFields.find(f => re.test(f.key));
    if (match) priorityKeys.push(match);
  });

  const remainingFields = orderedFields.filter(f => !priorityKeys.includes(f));
  const cstIdx = remainingFields.findIndex(f => /^cst required info/i.test(f.key));
  const insertAt = cstIdx >= 0 ? cstIdx + 1 : remainingFields.length;
  remainingFields.splice(insertAt, 0, ...priorityKeys);

  const visibleFields = remainingFields.filter(f => record.fields[f.key]);

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      onShowToast('Copied to clipboard');
      setTimeout(() => setCopiedKey(null), 1500);
    }).catch(() => {
      onShowToast('Could not copy automatically');
    });
  };

  // Group fields by group name
  const groups: { groupName: string; fields: FieldOrder[] }[] = [];
  let currentGroup = '';
  visibleFields.forEach(f => {
    const grp = f.group || 'Other Details';
    if (grp !== currentGroup) {
      currentGroup = grp;
      groups.push({ groupName: grp, fields: [f] });
    } else {
      groups[groups.length - 1].fields.push(f);
    }
  });

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <div className="drawer show" role="dialog" aria-modal="true">
        {/* Drawer Header */}
        <div className="drawer-head">
          <div className={`drawer-stripe ${crit ? 'critical' : ''}`} />
          <div className="drawer-head-text">
            <div className="drawer-eyebrow">
              {record._section ? `${record._section} · ` : ''}Case #{String(record._row).padStart(3, '0')}
            </div>
            <div className="drawer-title">{title}</div>
            {desc && <div className="drawer-desc" dir="auto">{desc}</div>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close case drawer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="drawer-body">
          {groups.map((grp, gIdx) => (
            <div key={gIdx} className="fgroup">
              <div className="fgroup-title">{grp.groupName}</div>
              {grp.fields.map(f => {
                const h = splitHeader(f.key);
                const val = record.fields[f.key] || '';
                const copyable = /script|ticket|note|template|step|نماذج|سكريبت/i.test(h.en) || val.length > 160;
                const isHighlighted = /^refund needed/i.test(h.en);
                const isHighlightedAlt = /^compensation needed/i.test(h.en);
                const isDone = copiedKey === f.key;

                return (
                  <div
                    key={f.key}
                    className={`field ${isHighlighted ? 'is-highlighted' : ''} ${isHighlightedAlt ? 'is-highlighted-alt' : ''}`}
                  >
                    <div className="field-label-row">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {f.link && /^(https?:|mailto:)/i.test(f.link) ? (
                          <a
                            className="field-label"
                            href={f.link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {h.en}
                          </a>
                        ) : (
                          <span className="field-label">{h.en}</span>
                        )}
                        {isHighlightedAlt && <span className="comp-badge" aria-hidden="true">🎁</span>}
                        {h.ar && <span className="field-label-ar">{h.ar}</span>}
                      </div>

                      {copyable && (
                        <button
                          className={`copy-btn ${isDone ? 'done' : ''}`}
                          onClick={() => handleCopy(f.key, val)}
                        >
                          {isDone ? 'Copied' : 'Copy'}
                        </button>
                      )}
                    </div>

                    <div className="field-value">
                      {isHighlightedAlt && (
                        <svg className="comp-orbit-svg" aria-hidden="true">
                          <rect
                            className="comp-orbit-rect"
                            x="0"
                            y="0"
                            width="100%"
                            height="100%"
                            rx="9"
                            pathLength="100"
                          />
                        </svg>
                      )}

                      {val.split(/\n\n+/).map((line, lIdx) => {
                        const rtl = isRTLText(line);
                        return (
                          <p
                            key={lIdx}
                            className="fval-line"
                            dir={rtl ? 'rtl' : 'auto'}
                            dangerouslySetInnerHTML={{ __html: linkify(esc(line)) }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
