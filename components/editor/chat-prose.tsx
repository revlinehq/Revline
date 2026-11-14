"use client";

import { memo, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ListType = "bullets" | "steps";
type ProseBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: ListType; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "code"; text: string };

const tableCells = (line: string) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());

function parseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let paragraph: string[] = [];
  let listType: ListType | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listType) {
      blocks.push({ type: listType, items: listItems });
      listType = null;
      listItems = [];
    }
  };

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    // A fenced code block keeps its lines and indentation as written.
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      while (++index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    // A markdown table: a | header | row, a |---| separator, then | rows |.
    if (line.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[index + 1]?.trim() ?? "")) {
      flushParagraph();
      flushList();
      const head = tableCells(line), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) rows.push(tableCells(lines[index++].trim()));
      index--;
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const markdownHeading = line.match(/^#{1,3}\s+(.+)$/);
    if (markdownHeading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        text: markdownHeading[1].trim(),
      });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    const step = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || step) {
      flushParagraph();
      const type = bullet ? "bullets" : "steps";
      if (listType !== type) flushList();
      listType = type;
      listItems.push((bullet?.[1] ?? step?.[1] ?? line).trim());
      continue;
    }

    if (listType && listItems.length > 0) {
      listItems[listItems.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return blocks;
}

function InlineMarkup({ text }: { text: string }) {
  let bold = false;
  const words: ReactNode[] = [];

  for (const match of text.matchAll(/\*\*|`[^`]+`|[^*`]+|\*|`/g)) {
    const word = match[0];
    if (word === "**") {
      bold = !bold;
      continue;
    }
    if (word.length > 2 && word.startsWith("`") && word.endsWith("`")) {
      words.push(<code key={match.index} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{word.slice(1, -1)}</code>);
      continue;
    }
    if (word === "*" && match.index === text.length - 1) continue;
    const content = word;
    words.push(
      bold ? (
        <strong
          key={match.index}
          className="font-semibold"
        >
          {content}
        </strong>
      ) : (
        <span key={match.index}>{content}</span>
      ),
    );
  }

  return words;
}

/** Markdown structure for chat text, shown as it arrives. */
export const ChatProse = memo(function ChatProse({ text }: { text: string }) {
  const blocks = parseBlocks(text.replace(/\\([_@])/g, "$1"));

  return (
    <div className="space-y-3.5">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          return (
            <h3 key={blockIndex} className="pt-0.5 font-semibold leading-snug">
              <InlineMarkup text={block.text} />
            </h3>
          );
        }
        if (block.type === "table") {
          return (
            <Table key={blockIndex} className="text-xs">
              <TableHeader><TableRow>{block.head.map((cell, cellIndex) => <TableHead key={cellIndex}><InlineMarkup text={cell} /></TableHead>)}</TableRow></TableHeader>
              <TableBody>{block.rows.map((row, rowIndex) => <TableRow key={rowIndex}>{row.map((cell, cellIndex) => <TableCell key={cellIndex} className="whitespace-normal align-top"><InlineMarkup text={cell} /></TableCell>)}</TableRow>)}</TableBody>
            </Table>
          );
        }
        if (block.type === "code") {
          return (
            <pre key={blockIndex} className="overflow-x-auto whitespace-pre rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={blockIndex}>
              <InlineMarkup text={block.text} />
            </p>
          );
        }

        const List = block.type === "steps" ? "ol" : "ul";
        return (
          <List
            key={blockIndex}
            className={`${block.type === "steps" ? "list-decimal" : "list-disc"} space-y-1.5 pl-5 marker:text-muted-foreground`}
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="pl-0.5">
                <InlineMarkup text={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
});
