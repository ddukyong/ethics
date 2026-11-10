/**
 * Q-메이커스 서버 (Google Apps Script)
 * - 1차시 질문 생성하기 + 2차시 질문 정교화하기 + 선생님 화면 연동
 * - 이 파일 전체를 Apps Script의 Code.gs에 붙여 넣고, [배포 관리]에서 새 버전으로 배포하기
 *   (자세한 방법은 저장소의 「서버_업데이트_방법.md」)
 */

/* ===== 선생님이 바꾸는 곳 ===== */
const TEACHER_KEY = "여기에-교사-비밀번호";   // 선생님으로 들어갈 때 쓰는 비밀번호 (꼭 바꾸기)
const PRACTICE_CODE = "practice26";           // resetPractice()로 비울 연습용 수업 코드
const MOUMS = 8;                              // 모둠 수 (index.html의 MOUMS와 같게)
const SHEET_ID = "";                          // 스프레드시트에 붙은 스크립트면 비워 둠
/* ============================ */

const STEP_IDS = ["1-1", "1-2", "1-3", "2-1", "2-2", "2-3"];
const CACHE_SEC = 21600; // 6시간

function doGet(){
  return ContentService.createTextOutput("Q-메이커스 서버가 작동 중입니다.");
}

function doPost(e){
  let out;
  try{ out = handle_(JSON.parse(e.postData.contents)); }
  catch(err){ out = { ok:false, error:String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p){
  const code = String(p.classCode || "").trim();
  const cls = findClass_(code);
  if(!cls) throw new Error("수업 코드를 다시 확인해 주세요.");
  const moum = String(p.moum || "");
  if(!/^\d+$/.test(moum) || +moum < 1 || +moum > MOUMS) throw new Error("모둠을 다시 골라 주세요.");
  const name = String(p.name || "").trim().slice(0, 10);
  if(!name) throw new Error("이름을 써 주세요.");

  switch(p.action){
    case "state": {
      const st = load_(code, moum);
      return { ok:true, state:(p.v === st.v ? null : st), cls:getCls_(code) };
    }
    case "op": {
      const op = p.op || {};
      if(["addCard", "delCard", "addLad", "editLad", "delLad"].indexOf(op.t) >= 0) op.name = name; // 남의 이름으로 바꾸지 못하게
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let st, before;
      try{
        st = load_(code, moum);
        before = JSON.stringify(st);
        applyOp(st, op);
        if(JSON.stringify(st) !== before){ st.v = (st.v || 0) + 1; save_(code, moum, st); }
      } finally { lock.releaseLock(); }
      try{ log_(cls, moum, name, op, st); }catch(err){ console.error(err); }
      return { ok:true, state:st, cls:getCls_(code) };
    }
    case "teacher": {
      checkTeacher_(p.key);
      return { ok:true, cls:getCls_(code) };
    }
    case "cls": {
      checkTeacher_(p.key);
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try{
        const c = getCls_(code);
        if(p.live !== undefined) c.live = !!p.live;
        if(p.step !== undefined && STEP_IDS.indexOf(p.step) >= 0) c.step = p.step;
        c.push = !!p.push;
        c.seq = (c.seq || 0) + 1;
        c.at = Date.now();
        putCls_(code, c);
        return { ok:true, cls:c };
      } finally { lock.releaseLock(); }
    }
  }
  throw new Error("알 수 없는 요청입니다.");
}

function checkTeacher_(key){
  if(!key || String(key) !== TEACHER_KEY) throw new Error("교사 비밀번호가 맞지 않아요.");
}

/* ===== 스프레드시트 ===== */
function book_(){ return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive(); }
function sheet_(name, header){
  const b = book_();
  let sh = b.getSheetByName(name);
  if(!sh){ sh = b.insertSheet(name); if(header) sh.appendRow(header); }
  return sh;
}

/* 반목록 시트: A열 반 이름, B열 반 코드 */
function findClass_(code){
  if(!code) return null;
  const cache = CacheService.getScriptCache();
  let list = null;
  try{ list = JSON.parse(cache.get("classes") || "null"); }catch(e){}
  if(!list){
    const sh = book_().getSheetByName("반목록");
    if(!sh) throw new Error("스프레드시트에 ‘반목록’ 시트가 없어요.");
    list = sh.getDataRange().getValues().slice(1)
      .filter(r => String(r[1]).trim())
      .map(r => ({ name:String(r[0]).trim(), code:String(r[1]).trim() }));
    cache.put("classes", JSON.stringify(list), 600);
  }
  return list.find(c => c.code === code) || null;
}

/* ===== 모둠 상태: 캐시에서 빠르게 읽고, ‘앱상태’ 시트에 늘 저장 ===== */
function stKey_(code, moum){ return "st:" + code + ":" + moum; }
function blank_(){ return norm({ v:0 }); }

function load_(code, moum){
  const k = stKey_(code, moum), cache = CacheService.getScriptCache();
  const hit = cache.get(k);
  if(hit){ try{ return norm(JSON.parse(hit)); }catch(e){} }
  const sh = sheet_("앱상태", ["반 코드", "모둠", "상태(JSON)", "저장 시각"]);
  const row = findRow_(sh, code, moum);
  let st = blank_();
  if(row){ try{ st = norm(JSON.parse(sh.getRange(row, 3).getValue() || "{}")); }catch(e){} }
  cache.put(k, JSON.stringify(st), CACHE_SEC);
  return st;
}

function save_(code, moum, st){
  const json = JSON.stringify(st);
  CacheService.getScriptCache().put(stKey_(code, moum), json, CACHE_SEC);
  const sh = sheet_("앱상태", ["반 코드", "모둠", "상태(JSON)", "저장 시각"]);
  const row = findRow_(sh, code, moum);
  if(row) sh.getRange(row, 3, 1, 2).setValues([[json, new Date()]]);
  else sh.appendRow([code, moum, json, new Date()]);
}

function findRow_(sh, code, moum){
  const n = sh.getLastRow(); if(n < 2) return 0;
  const vals = sh.getRange(2, 1, n - 1, 2).getValues();
  for(let i = 0; i < vals.length; i++){
    if(String(vals[i][0]) === code && String(vals[i][1]) === String(moum)) return i + 2;
  }
  return 0;
}

/* ===== 선생님 화면 연동 상태 ===== */
function getCls_(code){
  const cache = CacheService.getScriptCache(), k = "cls:" + code;
  const hit = cache.get(k);
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  let c = null;
  try{ c = JSON.parse(PropertiesService.getScriptProperties().getProperty(k) || "null"); }catch(e){}
  c = c || { live:false, step:"", seq:0, push:false };
  cache.put(k, JSON.stringify(c), CACHE_SEC);
  return c;
}
function putCls_(code, c){
  const k = "cls:" + code;
  CacheService.getScriptCache().put(k, JSON.stringify(c), CACHE_SEC);
  PropertiesService.getScriptProperties().setProperty(k, JSON.stringify(c));
}

/* ===== 기록 시트 (선생님이 보기 좋게) ===== */
function log_(cls, moum, name, op, st){
  const now = new Date();
  if(op.t === "addCard"){
    const c = st.cards.find(x => x.id === op.id); if(!c) return;
    sheet_("질문카드", ["시각", "반", "모둠", "학번", "이름", "질문", "자료", "자료에서 고른 부분"])
      .appendRow([now, cls.name, moum, "", name, c.text, c.src || "", c.q || ""]);
  }
  if(op.t === "done" && op.done){
    const textOf = id => (st.cards.find(c => c.id === id) || {}).text || "";
    const sh = sheet_("후보탐구질문", ["시각", "반", "모둠", "번호", "후보 탐구 질문", "고른 이유", "바탕이 된 질문", "마지막 AI 판단", "확정한 학생"]);
    st.cands.forEach((k, i) => sh.appendRow([now, cls.name, moum, i + 1, k.text, k.reason, k.from.map(textOf).filter(String).join(" / "), "", name]));
  }
  if(op.t === "done2" && op.done){
    const lsh = sheet_("정교화사다리", ["시각", "반", "모둠", "이름", "출발", "① 개념 연결", "② 범위·대상", "③ 탐구형", "도착(종합)"]);
    st.lads.forEach(l => lsh.appendRow([now, cls.name, moum, l.name, l.start, l.c1, l.c2, l.c3, l.end]));
    const ladText = id => { const l = st.lads.find(x => x.id === id); return l ? (l.end || l.c3 || l.c2 || l.c1 || l.start) : ""; };
    const row = [now, cls.name, moum, st.fin.text, st.fin.reason, st.fin.from.map(ladText).filter(String).join(" / ")];
    ["a", "b", "c"].forEach(k => { const s = st.subs[k]; row.push(s.q, s.check, s.src, s.who); });
    row.push(name);
    sheet_("2차시탐구계획", ["시각", "반", "모둠", "최종 탐구 질문", "고른 이유", "바탕이 된 질문",
      "하위①실태 질문", "하위① 확인할 것", "하위① 자료·출처", "하위① 담당",
      "하위②원인 질문", "하위② 확인할 것", "하위② 자료·출처", "하위② 담당",
      "하위③영향 질문", "하위③ 확인할 것", "하위③ 자료·출처", "하위③ 담당", "확정한 학생"]).appendRow(row);
  }
}

/* ===== 선생님이 편집기에서 직접 실행하는 함수 ===== */
/** 연습용 수업 코드(PRACTICE_CODE)의 모든 모둠 기록과 화면 연동을 비움 */
function resetPractice(){
  const code = PRACTICE_CODE;
  for(let m = 1; m <= MOUMS; m++) save_(code, String(m), blank_());
  putCls_(code, { live:false, step:"", seq:0, push:false });
  CacheService.getScriptCache().remove("classes");
}
/** 반목록 시트를 고친 뒤 바로 반영하고 싶을 때 */
function refreshClasses(){ CacheService.getScriptCache().remove("classes"); }

/* ===== 공통 규칙 시작 — Code.gs와 글자 하나까지 같아야 함 ===== */
function norm(st){
  st.v = st.v || 0;
  st.cards = st.cards || []; st.groups = st.groups || []; st.cands = st.cands || []; st.done = !!st.done;
  st.lads = st.lads || [];
  st.fin = st.fin || {};
  st.fin.text = st.fin.text || ""; st.fin.reason = st.fin.reason || ""; st.fin.from = st.fin.from || [];
  st.fin.chk = st.fin.chk || [false, false, false, false];
  st.subs = st.subs || {};
  ["a", "b", "c"].forEach(k => { st.subs[k] = st.subs[k] || {}; ["q", "check", "src", "who"].forEach(f => { st.subs[k][f] = st.subs[k][f] || ""; }); });
  st.subChk = st.subChk || [false, false, false];
  st.done2 = !!st.done2;
  return st;
}
function applyOp(st, op){
  norm(st);
  const cut = (s, n) => String(s == null ? "" : s).slice(0, n);
  const card = id => st.cards.find(x => x.id === id);
  const cand = id => st.cands.find(k => k.id === id);
  const lad = id => st.lads.find(l => l.id === id);
  switch(op.t){
    case "addCard": if(!card(op.id) && st.cards.length < 400) st.cards.push({ id:op.id, name:op.name, text:cut(op.text, 200), g:"", src:cut(op.src, 8), q:cut(op.q, 80) }); break;
    case "delCard": { const n = st.cards.length; st.cards = st.cards.filter(x => !(x.id === op.id && x.name === op.name));
      if(st.cards.length !== n) st.cands.forEach(k => { k.from = k.from.filter(f => f !== op.id); }); break; }
    case "move": { const x = card(op.id); if(x) x.g = cut(op.g, 40); break; }
    case "addGroup": if(!st.groups.find(g => g.id === op.id) && st.groups.length < 30) st.groups.push({ id:op.id, name:cut(op.name, 30) }); break;
    case "renameGroup": { const g = st.groups.find(g => g.id === op.id); if(g) g.name = cut(op.name, 30); break; }
    case "delGroup": st.groups = st.groups.filter(g => g.id !== op.id);
      st.cards.forEach(x => { if(x.g === op.id) x.g = ""; }); break;
    case "addCand": if(st.cands.length < 3 && !cand(op.id)) st.cands.push({ id:op.id, text:cut(op.text, 200), reason:"", from:(op.from || []).slice(0, 10) }); break;
    case "editCand": { const k = cand(op.id); if(!k) break;
      if(op.text !== undefined) k.text = cut(op.text, 200);
      if(op.reason !== undefined) k.reason = cut(op.reason, 300); break; }
    case "addFrom": { const k = cand(op.id); if(k && card(op.card) && !k.from.includes(op.card)) k.from.push(op.card); break; }
    case "delCand": st.cands = st.cands.filter(k => k.id !== op.id); break;
    case "done": st.done = !!op.done; break;
    case "addLad": if(!lad(op.id) && st.lads.length < 30) st.lads.push({ id:op.id, name:op.name, cand:cut(op.cand, 40), start:cut(op.start, 200), c1:"", c2:"", c3:"", end:"" }); break;
    case "editLad": { const l = lad(op.id); if(l && l.name === op.name && ["start", "c1", "c2", "c3", "end"].includes(op.f)) l[op.f] = cut(op.val, 200); break; }
    case "delLad": st.lads = st.lads.filter(l => !(l.id === op.id && l.name === op.name));
      st.fin.from = st.fin.from.filter(f => lad(f)); break;
    case "fin": if(op.f === "text" || op.f === "reason") st.fin[op.f] = cut(op.val, 300);
      if(Array.isArray(op.from)) st.fin.from = op.from.filter(f => lad(f)).slice(0, 5); break;
    case "finFrom": if(lad(op.lad) && !st.fin.from.includes(op.lad) && st.fin.from.length < 5) st.fin.from.push(op.lad); break;
    case "finChk": if(op.i >= 0 && op.i < 4) st.fin.chk[op.i] = !!op.val; break;
    case "sub": if(["a", "b", "c"].includes(op.k) && ["q", "check", "src", "who"].includes(op.f)) st.subs[op.k][op.f] = cut(op.val, 200); break;
    case "subChk": if(op.i >= 0 && op.i < 3) st.subChk[op.i] = !!op.val; break;
    case "done2": st.done2 = !!op.done; break;
  }
  return st;
}
/* ===== 공통 규칙 끝 ===== */
