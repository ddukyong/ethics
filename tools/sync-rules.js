// index.html의 ‘공통 규칙’ 부분을 Code.gs에 그대로 복사함.  사용: node tools/sync-rules.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const A = "/* ===== 공통 규칙 시작", B = "/* ===== 공통 규칙 끝 ===== */";
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const i = html.indexOf(A), j = html.indexOf(B);
if(i < 0 || j < 0) throw new Error("index.html에서 공통 규칙 표시를 찾지 못함");
const block = html.slice(i, j + B.length);
const gsPath = path.join(root, "Code.gs");
let gs = fs.readFileSync(gsPath, "utf8");
const gi = gs.indexOf(A), gj = gs.indexOf(B);
if(gi >= 0 && gj >= 0) gs = gs.slice(0, gi) + block + gs.slice(gj + B.length);
else if(gs.includes("/*__SHARED__*/")) gs = gs.replace("/*__SHARED__*/", block);
else throw new Error("Code.gs에 넣을 자리를 찾지 못함");
fs.writeFileSync(gsPath, gs);
console.log("Code.gs의 공통 규칙을 index.html과 같게 맞춤");
