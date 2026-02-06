import type { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

const extensionByExt: Readonly<Record<string, Extension>> = {
  c: cpp(),
  cc: cpp(),
  cpp: cpp(),
  cxx: cpp(),
  css: css(),
  h: cpp(),
  hpp: cpp(),
  html: html(),
  htm: html(),
  java: java(),
  js: javascript({ jsx: true }),
  jsx: javascript({ jsx: true }),
  mjs: javascript({ jsx: true }),
  cjs: javascript({ jsx: true }),
  ts: javascript({ typescript: true }),
  tsx: javascript({ typescript: true, jsx: true }),
  json: json(),
  md: markdown(),
  markdown: markdown(),
  py: python(),
  rs: rust(),
  sql: sql(),
  svg: xml(),
  xml: xml(),
  yml: yaml(),
  yaml: yaml(),
};

/**
 * 拡張子から CodeMirror の言語拡張を返す。
 * @param filePath 相対ファイルパス
 */
export const getLanguageExtension = (filePath: string): Extension[] => {
  const lowerPath = filePath.toLowerCase();
  const ext = lowerPath.includes('.') ? lowerPath.split('.').pop() : null;
  if (!ext) {
    return [];
  }
  const languageExtension = extensionByExt[ext] ?? null;
  return languageExtension ? [languageExtension] : [];
};
