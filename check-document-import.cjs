const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const [, attrs, source] of scripts) {
  if (!/\bsrc=/.test(attrs)) new vm.Script(source);
}

const start = html.indexOf("function loadLocalPdf(data)");
const end = html.indexOf("function extractPdfTextEnhanced(", start);
assert.ok(start >= 0 && end > start, "找不到共享 PDF 读取函数");
let options;
const ctx = vm.createContext({
  pdfjsLib: { getDocument(value) { options = value; return { promise: Promise.resolve() }; } }
});
vm.runInContext(html.slice(start, end), ctx);
ctx.loadLocalPdf(new Uint8Array());

const version = html.match(/\/pdf\.js\/([\d.]+)\/pdf\.min\.js/)?.[1];
assert.ok(version, "缺少 PDF.js 版本");
assert.ok(html.includes("/pdf.js/" + version + "/pdf.worker.min.js"), "PDF.js 后台组件版本不一致");
assert.ok(options.cMapPacked && options.cMapUrl.endsWith("@" + version + "/cmaps/"), "缺少匹配的 CMap");
assert.ok(options.standardFontDataUrl.endsWith("@" + version + "/standard_fonts/"), "缺少匹配的标准字体");
assert.equal((html.match(/pdfjsLib\.getDocument\(/g) || []).length, 1, "导入与重开必须共用 PDF 读取配置");

const ocrVersion = html.match(/tesseract\.js@([\d.]+)\/dist\/tesseract\.min\.js/)?.[1];
assert.ok(ocrVersion && html.includes("tesseract.js@" + ocrVersion + "/dist/worker.min.js"), "OCR 后台组件版本不一致");
assert.equal(ctx.pdfTextNeedsOcr("，。：……１２３".repeat(30), 1), true);
assert.equal(ctx.pdfTextNeedsOcr("2026111120261111".repeat(8), 1), true);
assert.equal(ctx.pdfTextNeedsOcr("这是一份可直接读取的旧版中文论文测试文字。".repeat(70), 4), false);
assert.equal(ctx.pdfTextNeedsOcr("正常文字夹杂损坏字符".repeat(15) + "�".repeat(20), 1), true);
Promise.all([
  ctx.hasPdfHeader(new Blob(["%PDF-1.6\n"])),
  ctx.hasPdfHeader(new Blob(["not a PDF"]))
]).then(results => {
  assert.deepEqual(results, [true, false]);
  console.log("PASS: script syntax, shared PDF resources, OCR versions and fallback, PDF header");
}).catch(error => { console.error(error); process.exitCode = 1; });
