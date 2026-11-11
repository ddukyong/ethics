// 앱을 고친 뒤 실행: index.html의 APP_VER와 version.json을 같은 새 번호로 바꿔요.
// 학생·선생님 화면에 "새 버전이 나왔어요 [새로 고침]" 안내가 떠요.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), d = new Date(Date.now() + 9 * 3600e3);
const v = d.toISOString().replace(/\D/g, "").slice(0, 12);
const f = path.join(root, "index.html");
fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/const APP_VER = "\d+";/, `const APP_VER = "${v}";`));
fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ v }) + "\n");
console.log("새 버전:", v);
