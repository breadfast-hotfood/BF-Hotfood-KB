import React, { useState } from 'react';
import { Tab, GridCell } from '../types';
import { tableRowMatches } from '../utils/kbUtils';
import { richTextSegments, highlightTextSegments, safeCellHref, tabLinkTarget } from '../utils/richText';

interface TableViewProps {
  tab: Tab;
  query: string;
  onActivateTabByName: (name: string) => void;
}

export const TableView: React.FC<TableViewProps> = ({ tab, query, onActivateTabByName }) => {
  const [openClamps, setOpenClamps] = useState<Record<string, boolean>>({});

  const matchedRows = tableRowMatches(tab, query);
  const isFiltered = Boolean(query.trim());

  if (!matchedRows.length) {
    return (
      <div className="text-center py-16 text-[var(--muted)]">
        <h2 className="text-lg font-bold text-[var(--text)] mb-1">
          {tab.grid.length ? 'No matches in this sheet' : 'This tab is empty'}
        </h2>
        <p className="text-xs">Try clearing the search query or switching tabs.</p>
      </div>
    );
  }

  let maxCols = 0;
  tab.grid.forEach(row => {
    if (row.length > maxCols) maxCols = row.length;
  });

  const isRowBlank = tab.grid.map(row => row.every(c => !c || (!c.v && !c.l)));

  const toggleClamp = (key: string) => {
    setOpenClamps(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSegments = (segments: ReturnType<typeof richTextSegments>) => segments.map((segment, i) => {
    const content = segment.type === 'mark' ? <mark>{segment.text}</mark> : segment.text;
    if (segment.href) {
      return <a key={i} href={segment.href} target="_blank" rel="noopener noreferrer">{content}</a>;
    }
    return segment.type === 'mark' ? <React.Fragment key={i}>{content}</React.Fragment> : <React.Fragment key={i}>{segment.text}</React.Fragment>;
  });

  const renderCellContent = (cell: GridCell, rowIdx: number, colIdx: number) => {
    const text = cell.v || '';
    const link = cell.l || '';
    const clampKey = `${rowIdx}-${colIdx}`;
    const isOpen = Boolean(openClamps[clampKey] || isFiltered);

    const safeHref = safeCellHref(link);
    const tabTarget = !safeHref ? tabLinkTarget(link) : null;
    let content: React.ReactNode;
    if (safeHref) {
      content = text.length > 40
        ? <>{renderSegments(richTextSegments(text, query))} <a href={safeHref} target="_blank" rel="noopener noreferrer">🔗 Open link</a></>
        : <a href={safeHref} target="_blank" rel="noopener noreferrer">{renderSegments(highlightTextSegments(text || link, query))}</a>;
    } else if (tabTarget) {
      content = <button
        type="button"
        className="cursor-pointer font-bold text-[var(--accent-contrast)] underline bg-transparent border-0 p-0"
        onClick={() => onActivateTabByName(tabTarget)}
      >{renderSegments(highlightTextSegments(text || tabTarget, query))}</button>;
    } else {
      content = renderSegments(link ? highlightTextSegments(text, query) : richTextSegments(text, query));
    }

    const needsClamp = text.length > 240 || text.split('\n').length > 7;

    return (
      <div>
        <div
          dir="auto"
          className={needsClamp ? `xt-clamp ${isOpen ? 'open' : ''}` : ''}
        >{content}</div>
        {needsClamp && !isFiltered && (
          <button
            type="button"
            className="xt-more"
            onClick={e => {
              e.stopPropagation();
              toggleClamp(clampKey);
            }}
          >
            {isOpen ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="xt-wrap">
      <table className="xt">
        <tbody>
          {matchedRows.map((r, k) => {
            const row = tab.grid[r];
            const prevRowIdx = k > 0 ? matchedRows[k - 1] : -1;
            let gap = false;
            for (let x = prevRowIdx + 1; x < r; x++) {
              if (isRowBlank[x]) gap = true;
            }

            const masters = row.filter(c => c && !c.cov && (c.v || c.l));
            const isHead = (k === 0 || gap) && masters.length >= 2;
            const isTitle = masters.length === 1 && (masters[0].cs! > 1 || (k === 0 && maxCols > 2));

            if (isTitle) {
              return (
                <tr key={r}>
                  <td className="xt-title" colSpan={Math.max(maxCols, 1)}>
                    {renderCellContent(masters[0], r, 0)}
                  </td>
                </tr>
              );
            }

            return (
              <tr key={r}>
                {row.map((cell, c) => {
                  if (cell && cell.cov) {
                    if (isFiltered && cell.cov[0] < r && cell.cov[1] === c) {
                      const m = tab.grid[cell.cov[0]][cell.cov[1]];
                      return (
                        <td
                          key={c}
                          colSpan={m.cs && m.cs > 1 ? Math.min(m.cs, row.length - c) : undefined}
                        >
                          {renderCellContent(m, r, c)}
                        </td>
                      );
                    }
                    return null;
                  }

                  if (!cell || (!cell.v && !cell.l)) {
                    return isHead ? <th key={c} /> : <td key={c} />;
                  }

                  const colSpanVal = cell.cs && cell.cs > 1 ? Math.min(cell.cs, row.length - c) : undefined;
                  let rowSpanVal: number | undefined;
                  if (!isFiltered && cell.rs && cell.rs > 1) {
                    const rsEff = matchedRows.filter(z => z >= r && z < r + cell.rs!).length;
                    if (rsEff > 1) rowSpanVal = rsEff;
                  }

                  if (isHead) {
                    return (
                      <th key={c} colSpan={colSpanVal} rowSpan={rowSpanVal}>
                        {renderCellContent(cell, r, c)}
                      </th>
                    );
                  }

                  return (
                    <td key={c} colSpan={colSpanVal} rowSpan={rowSpanVal}>
                      {renderCellContent(cell, r, c)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
