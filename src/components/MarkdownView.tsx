import type { ReactNode } from "react";

interface MarkdownViewProps {
  markdown: string;
  className?: string;
  emptyText?: string;
}

export function MarkdownView({ markdown, className = "", emptyText = "Nothing written yet." }: MarkdownViewProps) {
  const classes = ["markdown-view", className].filter(Boolean).join(" ");

  return <div className={classes}>{renderMarkdown(markdown, emptyText)}</div>;
}

function renderMarkdown(markdown: string, emptyText: string): ReactNode[] {
  const lines = markdown.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const fence = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <pre key={`code-${index}`}>
          {fence ? <span className="markdown-code-label">{fence}</span> : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const { nextIndex, rows } = collectTable(lines, index);
      const [headers, ...bodyRows] = rows;
      nodes.push(
        <div className="markdown-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {headers.map((header, headerIndex) => <th key={`${header}-${headerIndex}`}>{renderInline(header)}</th>)}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      if (level === 1) nodes.push(<h1 key={`h-${index}`}>{content}</h1>);
      if (level === 2) nodes.push(<h2 key={`h-${index}`}>{content}</h2>);
      if (level === 3) nodes.push(<h3 key={`h-${index}`}>{content}</h3>);
      if (level === 4) nodes.push(<h4 key={`h-${index}`}>{content}</h4>);
      index += 1;
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s+/.test(lines[index])) {
        quotes.push(lines[index].replace(/^>\s+/, ""));
        index += 1;
      }
      nodes.push(<blockquote key={`quote-${index}`}>{quotes.map((quote, quoteIndex) => <p key={quoteIndex}>{renderInline(quote)}</p>)}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>)}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    nodes.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return nodes.length ? nodes : [<p className="quiet-text" key="empty">{emptyText}</p>];
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];

  return (
    line.startsWith("```") ||
    /^(#{1,4})\s+/.test(line) ||
    /^>\s+/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]));
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function collectTable(lines: string[], startIndex: number): { nextIndex: number; rows: string[][] } {
  const rows = [parseTableRow(lines[startIndex])];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(parseTableRow(lines[index]));
    index += 1;
  }

  return { nextIndex: index, rows };
}

function parseTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(value: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);

  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
      }

      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
      }

      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2];
        const external = /^https?:\/\//.test(href);
        return (
          <a key={`${part}-${index}`} href={href} rel={external ? "noreferrer" : undefined} target={external ? "_blank" : undefined}>
            {link[1]}
          </a>
        );
      }

      return <span key={`${part}-${index}`}>{part}</span>;
    });
}
