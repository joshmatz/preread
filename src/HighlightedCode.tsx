import React, { useMemo } from "react";
import { hljs } from "diff2html/lib/ui/js/highlight.js-slim.js";

export function HighlightedCode({ code, language, decorate }: {
  code: string; language: string; decorate?: (block: Element) => void;
}) {
  const { supported, markup } = useMemo(() => {
    const supported = hljs.getLanguage(language) && !code.split("\n").some(line => line.length > 10000) ? language : "plaintext";
    let html = hljs.highlight(code, { language: supported, ignoreIllegals: true }).value;
    if (decorate) {
      const block = document.createElement("code");
      block.innerHTML = html;
      decorate(block);
      html = block.innerHTML;
    }
    return { supported, markup: { __html: html } };
  }, [code, language, decorate]);
  return <code className={`hljs language-${supported}`} dangerouslySetInnerHTML={markup} />;
}
