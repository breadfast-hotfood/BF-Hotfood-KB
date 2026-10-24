import React, { useState } from 'react';
import { shouldCollapse } from '../utils/collapse';

interface CollapsibleValueProps {
  text: string;
  children: React.ReactNode; // the already-rendered (escaped + linkified) paragraphs
}

// Wraps a field value. Short values are rendered untouched. Long values start collapsed
// (clipped, with a fade) and get a per-field "See more" / "Show less" button.
// The full text always stays in the DOM, so links, selection and the Copy button keep working.
export const CollapsibleValue: React.FC<CollapsibleValueProps> = ({ text, children }) => {
  const collapsible = shouldCollapse(text);
  const [open, setOpen] = useState(false);

  if (!collapsible) return <>{children}</>;

  return (
    <>
      <div className={`fval-clip ${open ? 'open' : 'collapsed'}`}>{children}</div>
      <button
        type="button"
        className="fval-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {open ? 'Show less' : 'See more'}
      </button>
    </>
  );
};
