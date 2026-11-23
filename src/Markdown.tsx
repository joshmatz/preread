import React, { createContext, useContext, useEffect, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { HighlightedCode } from "./HighlightedCode";
import { CallTree } from "./CallTree";
import { BriefGroupStatus, type GroupReadState } from "./BriefGroupStatus";

// Without a group, a link opens the review itself: its brief, or its code when it has none.
export type BriefLink = { review: string; group?: string };
const reference = /^preread:([a-z0-9][a-z0-9-]{0,79})(?:\/([a-z0-9][a-z0-9-]{0,79}))?$/;

function MarkdownTable({ node: _node, ...props }: ComponentProps<"table"> & ExtraProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const scroll = scrollRef.current;
    const table = tableRef.current;
    if (!scroll || !table) return;

    const measure = () => setOverflowing(scroll.scrollWidth > scroll.clientWidth);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(scroll);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return <div ref={scrollRef} className="markdown-table-scroll" tabIndex={overflowing ? 0 : undefined}
    role={overflowing ? "group" : undefined} aria-label={overflowing ? "Scrollable table" : undefined}>
    <table {...props} ref={tableRef} />
  </div>;
}

type MarkdownContext = {
  onReference?: (reference: BriefLink) => void; referenceState?: (reference: BriefLink) => GroupReadState | undefined;
  /** Offsets of the comments in the brief block this Markdown is, so a call tree can open the steps they are on. */
  marks?: Array<[number, number]>;
  /** The language of a code block that names none. */
  language?: string;
};
const MarkdownContext = createContext<MarkdownContext>({});

function MarkdownPre({ node, ...props }: ComponentProps<"pre"> & ExtraProps) {
  const { marks, language: fallback } = useContext(MarkdownContext);
  const code = node?.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return <pre {...props} />;
  const text = code.children.map((child) => child.type === "text" ? child.value : "").join("");
  const language = /^language-(.+)$/.exec(String(code.properties.className ?? ""))?.[1] ?? fallback;
  return language === "call-tree" ? <CallTree code={text} marks={marks} />
    : language ? <pre><HighlightedCode code={text} language={language} /></pre> : <pre {...props} />;
}

function MarkdownLink({ href, children }: ComponentProps<"a"> & ExtraProps) {
  const { onReference, referenceState } = useContext(MarkdownContext);
  const match = href?.match(reference);
  if (match) {
    const target: BriefLink = match[2] ? { review: match[1], group: match[2] } : { review: match[1] };
    const state = referenceState?.(target);
    return onReference
      ? <button className="brief-inline-reference" onClick={() => onReference(target)}>{children} ↗{state
        && <BriefGroupStatus state={state} subject={target.group ? undefined : "Review"} />}</button>
      : <span>{children}</span>;
  }
  return href ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noreferrer">{children}</a> : <span>{children}</span>;
}

// A component made during render is a new type each time, so React would rebuild its elements and drop a selection inside them.
const components: Components = {
  table: MarkdownTable,
  pre: MarkdownPre,
  img: () => <span className="muted">[Use an imported visual block to show this image.]</span>,
  a: MarkdownLink,
};
const commentComponents: Components = {
  ...components,
  img: ({ src, alt }) => typeof src === "string" && src ? <a href={src} target="_blank" rel="noreferrer">{alt || src}</a> : <>{alt}</>,
};
const plugins = [remarkGfm];
const transformUrl = (url: string) => reference.test(url) ? url : defaultUrlTransform(url);

export function Markdown({ children, onReference, referenceState, marks }: { children: string } & Omit<MarkdownContext, "language">) {
  return <div className="markdown"><MarkdownContext.Provider value={{ onReference, referenceState, marks }}>
    <ReactMarkdown remarkPlugins={plugins} skipHtml urlTransform={transformUrl} components={components}>{children}</ReactMarkdown>
  </MarkdownContext.Provider></div>;
}

// Unlike an overview, a comment shows HTML as the text it was typed as, so `Promise<void>` keeps its `<void>`.
export function CommentText({ children, className, language }: { children: string; className: string; language?: string }) {
  return <div className={`markdown comment-markdown ${className}`}><MarkdownContext.Provider value={{ language }}>
    <ReactMarkdown remarkPlugins={plugins} urlTransform={transformUrl} components={commentComponents}>{children}</ReactMarkdown>
  </MarkdownContext.Provider></div>;
}

const parser = unified().use(remarkParse).use(plugins);
type Node = ReturnType<typeof parser.parse> | ReturnType<typeof parser.parse>["children"][number];
const phrasing = new Set(["paragraph", "heading", "tableCell", "emphasis", "strong", "delete", "link", "linkReference"]);
const textOf = (node: Node): string => node.type === "break" ? "\n" : "value" in node ? node.value
  : "children" in node ? (node.children as Node[]).map(textOf).join(phrasing.has(node.type) ? "" : "\n") : "";
export const plainText = (markdown: string) => textOf(parser.parse(markdown)).trim();
