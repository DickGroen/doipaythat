// worker/utils/rtf.js

export function rtfToBase64(rtf) {
  const bytes = [];

  for (let i = 0; i < rtf.length; i++) {
    const code = rtf.charCodeAt(i);

    if (code < 128) {
      bytes.push(code);
    } else {
      const escaped = `\\u${code}?`;
      for (let j = 0; j < escaped.length; j++) {
        bytes.push(escaped.charCodeAt(j));
      }
    }
  }

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary);
}

function esc(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\u2014/g, "\\emdash ")
    .replace(/\u2013/g, "\\endash ")
    .replace(/\u2018/g, "\\'91")
    .replace(/\u2019/g, "\\'92")
    .replace(/\u201c/g, "\\'93")
    .replace(/\u201d/g, "\\'94")
    .replace(/\u00a3/g, "\\'a3")
    .replace(/\u20ac/g, "\\'80")
    .replace(/\*/g, "")
    .replace(/\n/g, "\\par\n");
}

function stripBlocks(text = "") {
  return String(text).replace(/\[\/?\w+\]/g, "").trim();
}

function getBlock(text, block) {
  const regex = new RegExp(`\\[${block}\\]([\\s\\S]*?)\\[\\/${block}\\]`, "i");
  const match = String(text).match(regex);
  return match ? match[1].trim() : "";
}

function stripTrailingDisclaimer(text = "") {
  return String(text)
    .replace
