"use client";

import type { ReactNode } from "react";
import { FlowTokenText } from "@/components/core/flowtoken";

type ListType = "bullets" | "steps";
type ProseBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: ListType; items: string[] };

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

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const markdownHeading = line.match(/^#{1,3}\s+(.+)$/);
    const boldHeading = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (markdownHeading || boldHeading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        text: (markdownHeading?.[1] ?? boldHeading?.[1] ?? line).trim(),
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

function InlineMarkup({ text, animate }: { text: string; animate: boolean }) {
  let bold = false;
  const words: ReactNode[] = [];

  for (const match of text.matchAll(/\*\*|[^*]+|\*/g)) {
    const word = match[0];
    if (word === "**") {
      bold = !bold;
      continue;
    }
    if (word === "*" && match.index === text.length - 1) continue;
    const content = <FlowTokenText input={word} animation={animate ? "fadeIn" : null}
      animationDuration="0.6s" animationTimingFunction="ease-in-out" />;
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

/** Markdown structure for text already revealed by the response renderer. */
export function ChatProse({
  text,
  animate = false,
}: {
  text: string;
  animate?: boolean;
}) {
  const blocks = parseBlocks(text.replace(/\\([_@])/g, "$1"));

  return (
    <div className="space-y-3.5">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          return (
            <h3 key={blockIndex} className="pt-0.5 font-semibold leading-snug">
              <InlineMarkup text={block.text} animate={animate} />
            </h3>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={blockIndex}>
              <InlineMarkup text={block.text} animate={animate} />
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
                <InlineMarkup text={item} animate={animate} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
