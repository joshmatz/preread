import React from "react";
import { hljs } from "diff2html/lib/ui/js/highlight.js-slim.js";

export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const supported = hljs.getLanguage(language) && !code.split("\n").some((line) => line.length > 10000) ? language : "plaintext";
  return <code className={`hljs language-${supported}`} dangerouslySetInnerHTML={{
    __html: hljs.highlight(code, { language: supported, ignoreIllegals: true }).value,
  }} />;
}
