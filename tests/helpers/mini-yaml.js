// テストでワークフロー定義を読むための極小 YAML パーサ。
// 依存を増やさない (D-001) ため、.github/workflows/ で使う範囲の構文だけを扱う。
//
// 対応するのは「インデントによる入れ子マップ」「`- ` のシーケンス」
// 「`[a, b]` のインライン配列」「引用符」「`#` のコメント」「`key: |` のブロックスカラー」だけ。
// これ以上の構文をワークフローに書いたら、パーサではなくワークフローを見直す。
//
// ブロックスカラーの制約: 行頭の共通インデントを外し、相対インデントは残して改行で連結する。
// 空行は捨てる。`#` 以降は (シェルのコメントでも) コメントとして落とす。
function stripComment(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      break;
    }
    out += ch;
  }
  return out.trimEnd();
}

function scalar(text) {
  const value = text.trim();
  if (value === "") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((part) => scalar(part));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

export function parseYaml(text) {
  const lines = text
    .split("\n")
    .map((line) => ({ indent: line.search(/\S/), text: stripComment(line) }))
    .filter((line) => line.indent >= 0 && line.text.trim() !== "");

  let cursor = 0;

  function parseBlock(indent) {
    if (cursor >= lines.length) return null;
    if (lines[cursor].text.trim().startsWith("- ")) return parseSequence(indent);
    return parseMapping(indent);
  }

  function parseSequence(indent) {
    const items = [];
    while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.trim().startsWith("- ")) {
      const rest = lines[cursor].text.trim().slice(2);
      const itemIndent = lines[cursor].indent + 2;
      if (/^[\w.$-]+:( |$)/.test(rest)) {
        // `- key: value` は、その行を同じ深さのマップの先頭として読み直す
        lines[cursor] = { indent: itemIndent, text: " ".repeat(itemIndent) + rest };
        items.push(parseMapping(itemIndent));
      } else {
        cursor += 1;
        items.push(scalar(rest));
      }
    }
    return items;
  }

  function parseBlockScalar(indent) {
    const chunk = [];
    while (cursor < lines.length && lines[cursor].indent > indent) {
      chunk.push(lines[cursor]);
      cursor += 1;
    }
    const base = Math.min(...chunk.map((line) => line.indent));
    return chunk.map((line) => line.text.slice(base)).join("\n");
  }

  function parseMapping(indent) {
    const map = {};
    while (cursor < lines.length && lines[cursor].indent === indent && !lines[cursor].text.trim().startsWith("- ")) {
      const line = lines[cursor].text.trim();
      const split = line.indexOf(":");
      const key = line.slice(0, split).trim();
      const rest = line.slice(split + 1);
      cursor += 1;
      if (rest.trim() === "|" || rest.trim() === ">") {
        map[key] = parseBlockScalar(indent);
      } else if (rest.trim() === "" && cursor < lines.length && lines[cursor].indent > indent) {
        map[key] = parseBlock(lines[cursor].indent);
      } else {
        map[key] = scalar(rest);
      }
    }
    return map;
  }

  return parseBlock(lines[0].indent);
}
