/**
 * Q-메이커스 서버 (Google Apps Script) — 1~6차시 통합 워크북
 * - 학번·이름으로 들어가면 모둠 활동과 개인 활동이 계속 이어짐
 * - 선생님 화면 연동, 집중 모드(화면 이탈 시간 기록), 모둠 사이 발표 댓글, 5·6차시 자기주도 탐구 열기
 * - 이 파일 전체를 Apps Script의 Code.gs에 붙여 넣고, [배포 관리]에서 새 버전으로 배포하기
 */

/* ===== 선생님이 바꾸는 곳 ===== */
const TEACHER_KEY = "여기에-교사-비밀번호";   // 선생님으로 들어갈 때 쓰는 비밀번호 (꼭 바꾸기)
                                              // 스크립트 속성 TEACHER_KEY가 있으면 그것을 먼저 씀
const PRACTICE_CODE = "practice26";           // resetPractice()로 비울 연습용 수업 코드
const MOUMS = 8;                              // 모둠 수 (index.html의 MOUMS와 같게)
const SHEET_ID = "";                          // 스프레드시트에 붙은 스크립트면 비워 둠
/* ============================ */

const STEP_IDS = ["0-1", "1-1", "1-2", "1-3", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3", "4-1", "4-2", "4-3", "5-1", "5-2", "5-3", "6-1", "6-2"];
const DEADLINE = new Date("2026-12-20T23:59:59+09:00"); // 자기주도 탐구(5·6차시) 마감
const STEP_NAME = { "0-1":"질문 쏟아내기 연습", "1-1":"질문 쏟아내기", "1-2":"비슷한 것끼리 묶기", "1-3":"후보 탐구 질문 추리기", "2-1":"후보 질문 정교화하기", "2-2":"최종 탐구 질문 정하기",
  "2-3":"하위 질문·조사 계획", "3-1":"하위 질문 자료 조사", "3-2":"조사 내용 공유·보완", "3-3":"답변 작성", "4-1":"발표 준비", "4-2":"발표와 댓글",
  "4-3":"배움 정리", "5-1":"새 사례 찾고 질문 쏟아내기", "5-2":"나의 탐구 질문 정하기", "5-3":"하위 질문·탐구 계획", "6-1":"자료 조사 기록", "6-2":"정책 제안서" };
const CACHE_SEC = 21600; // 6시간
const OWNED = ["addCard", "delCard", "addLad", "editLad", "delLad", "addFb", "delFb"];

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
  const teacher = String(p.name || "") === "선생님" && !String(p.sid || "").trim();
  if(teacher) checkTeacher_(p.key);
  const sid = String(p.sid || "").trim().slice(0, 10);
  const name = String(p.name || "").trim().slice(0, 10);
  if(!teacher){
    if(!/^\d{3,10}$/.test(sid)) throw new Error("학번을 숫자로 써 주세요.");
    if(!name) throw new Error("이름을 써 주세요.");
  }
  const uid = teacher ? "선생님" : sid + " " + name;
  const moumOk = m => /^\d+$/.test(String(m)) && +m >= 1 && +m <= MOUMS;

  if(p.action === "login"){
    let moum = String(p.moum || "");
    let pp = teacher ? blankP_() : loadP_(code, uid);
    let oldMoum = "";
    if(!teacher){
      if(moumOk(moum) && pp.moum !== moum){ oldMoum = pp.moum; pp.moum = moum; pp.v++; saveP_(code, uid, pp); }
      moum = pp.moum;
    }
    if(!moumOk(moum)) throw new Error(teacher ? "볼 모둠을 골라 주세요." : "처음 들어올 때는 모둠을 골라 주세요.");
    if(!teacher) joinMoum_(code, moum, oldMoum, uid);
    return { ok:true, uid, moum, state:load_(code, moum), p:pp, cls:getCls_(code), now:Date.now() };
  }

  const moum = String(p.moum || "");
  if(!moumOk(moum)) throw new Error("모둠을 다시 골라 주세요.");

  switch(p.action){
    case "state": {
      const st = load_(code, moum);
      const pp = teacher ? null : loadP_(code, uid);
      return { ok:true, state:(p.v === st.v ? null : st), p:(!pp || p.pv === pp.v ? null : pp), cls:getCls_(code), now:Date.now() };
    }
    case "op": {
      const op = p.op || {};
      if(OWNED.indexOf(op.t) >= 0) op.name = uid; // 남의 이름으로 바꾸지 못하게
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let st;
      try{
        st = load_(code, moum);
        const before = JSON.stringify(st);
        applyOp(st, op);
        if(JSON.stringify(st) !== before){ st.v = (st.v || 0) + 1; save_(code, moum, st); }
      } finally { lock.releaseLock(); }
      try{ log_(cls, moum, sid, name, op, st); }catch(err){ console.error(err); }
      return { ok:true, state:st, cls:getCls_(code) };
    }
    case "pset": {
      if(teacher) throw new Error("선생님 화면에서는 쓸 수 없어요.");
      const f = String(p.f || "");
      if(!/^s[456][a-z0-9]{1,12}$/.test(f)) throw new Error("저장할 수 없는 칸이에요.");
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let pp, submitted = false;
      try{
        pp = loadP_(code, uid);
        if(/^s[56]/.test(f) && new Date() > DEADLINE) throw new Error("마감(12. 20.)이 지나 더 고칠 수 없어요.");
        if(/sub$/.test(f)){
          const on = !!p.val;
          pp.f[f] = on ? Utilities.formatDate(new Date(), "Asia/Seoul", "M월 d일 HH:mm") : "";
          submitted = on;
        } else {
          pp.f[f] = String(p.val == null ? "" : p.val).slice(0, 3000);
        }
        pp.v++; saveP_(code, uid, pp);
      } finally { lock.releaseLock(); }
      if(submitted){ try{ logSubmit_(cls, moum, sid, name, f, pp); }catch(err){ console.error(err); } }
      return { ok:true, p:pp };
    }
    case "notes": {
      if(teacher) return { ok:true };
      const n = p.notes || {};
      const notes = { marks:(Array.isArray(n.marks) ? n.marks : []).slice(0, 600), memos:(n.memos && typeof n.memos === "object") ? n.memos : {} };
      if(JSON.stringify(notes).length > 60000) throw new Error("표시와 메모가 너무 많아요.");
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let pp;
      try{ pp = loadP_(code, uid); pp.notes = notes; pp.v++; saveP_(code, uid, pp); }
      finally { lock.releaseLock(); }
      return { ok:true, pv:pp.v };
    }
    case "leave": {
      if(teacher) return { ok:true };
      const sec = Math.max(0, Math.round(+p.sec || 0));
      sheet_("화면이탈기록", ["기록 시각", "반 코드", "반", "모둠", "학번", "이름", "벗어난 시각", "돌아온 시각", "이탈 시간(초)", "이탈 시간"])
        .appendRow([new Date(), code, cls.name, moum, sid, name, String(p.start || "").slice(0, 12), String(p.end || "").slice(0, 20), sec, Math.floor(sec / 60) + "분 " + (sec % 60) + "초"]);
      return { ok:true };
    }
    case "leaves": {
      checkTeacher_(p.key);
      const sh = book_().getSheetByName("화면이탈기록");
      const rows = !sh || sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues()
        .filter(r => String(r[1]) === code).slice(-200).reverse()
        .map(r => [r[3] + "모둠", r[4], r[5], r[6], r[7], r[9]].map(String));
      return { ok:true, rows };
    }
    case "all": {
      checkTeacher_(p.key);
      const states = [];
      for(let m = 1; m <= MOUMS; m++) states.push(load_(code, String(m)));
      return { ok:true, states };
    }
    case "board": {
      const board = [];
      for(let m = 1; m <= MOUMS; m++){
        const st = load_(code, String(m));
        board.push({ moum:m, q:st.fin.text, answer:st.concl.answer, evidence:st.concl.evidence, cmts:st.cmts });
      }
      return { ok:true, board };
    }
    case "cmt":
    case "uncmt": {
      const to = String(p.to || "");
      if(!moumOk(to)) throw new Error("발표 모둠을 골라 주세요.");
      if(!teacher && to === moum) throw new Error("우리 모둠에는 댓글을 남길 수 없어요.");
      const kind = String(p.kind || "");
      if(p.action === "cmt" && ["like", "fix", "ask", "link"].indexOf(kind) < 0) throw new Error("댓글 종류를 골라 주세요.");
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let st;
      try{
        st = load_(code, to);
        const op = p.action === "cmt" ? { t:"addCmt", id:String(p.id || ""), name:uid, from:teacher ? "교사" : moum, kind, text:String(p.text || "") }
                                      : { t:"delCmt", id:String(p.id || ""), name:uid };
        const before = JSON.stringify(st);
        applyOp(st, op);
        if(JSON.stringify(st) !== before){ st.v = (st.v || 0) + 1; save_(code, to, st); }
      } finally { lock.releaseLock(); }
      if(p.action === "cmt"){
        const KN = { like:"좋아요", fix:"보완이 필요한 점", ask:"궁금한 점", link:"연결되는 점" };
        try{ sheet_("4차시댓글", ["시각", "반", "발표 모둠", "남긴 모둠", "학번", "이름", "종류", "내용"])
          .appendRow([new Date(), cls.name, to, teacher ? "교사" : moum, sid, teacher ? "선생님" : name, KN[kind], String(p.text || "").slice(0, 300)]); }catch(err){ console.error(err); }
      }
      return { ok:true, cmts:st.cmts };
    }
    /* ===== 질문 쏟아내기 연습: 라운드 1은 5분, 라운드 2는 2분 · 순위 ===== */
    case "warmStart": {
      const WARM_SEC = { 1:300, 2:120 };
      checkTeacher_(p.key);
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try{
        const c = getCls_(code), w = c.warm || { game:0 };
        const r = Math.min(2, Math.max(1, +p.round || 1));
        const game = p.newGame || !w.game ? (w.game || 0) + 1 : w.game;
        c.warm = { game, round:r, start:p.reset ? 0 : Date.now() + 3000, sec:WARM_SEC[r] };
        putCls_(code, c);
        return { ok:true, cls:c, now:Date.now() };
      } finally { lock.releaseLock(); }
    }
    case "warm": {
      if(teacher) throw new Error("선생님 화면에서는 질문을 올릴 수 없어요.");
      const w = getCls_(code).warm, now = Date.now();
      if(!w || now < w.start - 1000 || now > w.start + w.sec * 1000 + 2500) throw new Error("지금은 질문을 올리는 시간이 아니에요.");
      const text = String(p.text || "").trim().slice(0, 200);
      if(text.length < 2) throw new Error("질문을 써 주세요.");
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      let counts;
      try{
        counts = warmCounts_(code, w.game, w.round);
        const me_ = counts[uid] = counts[uid] || { name, moum, n:0, last:[] };
        if(me_.last.indexOf(text) >= 0) return { ok:true, n:me_.n, dup:true };
        me_.n++; me_.last = me_.last.concat(text).slice(-50); me_.moum = moum;
        CacheService.getScriptCache().put("warmc:" + code + ":" + w.game + ":" + w.round, JSON.stringify(counts), CACHE_SEC);
      } finally { lock.releaseLock(); }
      try{ sheet_("질문연습", ["시각", "반", "게임", "라운드", "모둠", "학번", "이름", "질문"]).appendRow([new Date(), cls.name, w.game, w.round, moum, sid, name, text]); }catch(err){ console.error(err); }
      return { ok:true, n:counts[uid].n };
    }
    case "warmRank": {
      const w = getCls_(code).warm;
      if(!w) return { ok:true, game:0, round:0, rank:[], total:[] };
      const list = cs => Object.keys(cs).map(u => ({ uid:u, name:cs[u].name, moum:cs[u].moum, n:cs[u].n, r1:cs[u].r1, r2:cs[u].r2 })).sort((a, b) => b.n - a.n);
      const per = [1, 2].map(r => warmCounts_(code, w.game, r)), sum = {};
      per.forEach(cs => Object.keys(cs).forEach(u => { const x = sum[u] = sum[u] || { name:cs[u].name, moum:cs[u].moum, n:0, r1:0, r2:0 }; x.n += cs[u].n; }));
      per.forEach((cs, i) => Object.keys(cs).forEach(u => { sum[u]["r" + (i + 1)] = cs[u].n; }));
      return { ok:true, game:w.game, round:w.round, rank:list(per[w.round - 1]), total:list(sum) };
    }
    case "teacher": {
      checkTeacher_(p.key);
      return { ok:true, cls:getCls_(code), now:Date.now() };
    }
    case "cls": {
      checkTeacher_(p.key);
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try{
        const c = getCls_(code);
        if(p.live !== undefined) c.live = !!p.live;
        if(p.lock !== undefined) c.lock = !!p.lock;
        if(p.open56 !== undefined) c.open56 = !!p.open56;
        if(p.step !== undefined && STEP_IDS.indexOf(p.step) >= 0) c.step = p.step;
        c.push = !!p.push;
        c.seq = (c.seq || 0) + 1;
        c.at = Date.now();
        putCls_(code, c);
        return { ok:true, cls:c, now:Date.now() };
      } finally { lock.releaseLock(); }
    }
  }
  throw new Error("알 수 없는 요청입니다.");
}

/* 로그인한 학생을 그 모둠의 모둠원 목록(st.mem)에 올림. 모둠을 옮기면 예전 모둠에서는 뺌 */
function joinMoum_(code, moum, oldMoum, uid){
  const st0 = load_(code, moum);
  if(st0.mem.indexOf(uid) >= 0 && !moumOk_(oldMoum)) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const st = load_(code, moum);
    if(st.mem.indexOf(uid) < 0){ st.mem.push(uid); st.v = (st.v || 0) + 1; save_(code, moum, st); }
    if(moumOk_(oldMoum) && oldMoum !== moum){
      const o = load_(code, oldMoum);
      if(o.mem.indexOf(uid) >= 0){ o.mem = o.mem.filter(x => x !== uid); o.v = (o.v || 0) + 1; save_(code, oldMoum, o); }
    }
  } finally { lock.releaseLock(); }
}
function moumOk_(m){ return /^\d+$/.test(String(m)) && +m >= 1 && +m <= MOUMS; }

/* 연습 회차별 질문 수 — 캐시에 없으면 ‘질문연습’ 시트에서 다시 셈 */
function warmCounts_(code, game, round){
  const hit = CacheService.getScriptCache().get("warmc:" + code + ":" + game + ":" + round);
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  const counts = {}, cls = findClass_(code), sh = book_().getSheetByName("질문연습");
  if(sh && sh.getLastRow() >= 2){
    sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(r => {
      if(String(r[1]) !== cls.name || String(r[2]) !== String(game) || String(r[3]) !== String(round)) return;
      const u = String(r[5]) + " " + String(r[6]);
      const c = counts[u] = counts[u] || { name:String(r[6]), moum:String(r[4]), n:0, last:[] };
      c.n++; c.last.push(String(r[7]));
    });
  }
  return counts;
}

function checkTeacher_(key){
  const real = PropertiesService.getScriptProperties().getProperty("TEACHER_KEY") || TEACHER_KEY;
  if(!key || String(key) !== real) throw new Error("교사 비밀번호가 맞지 않아요.");
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
    list = !sh ? [] : sh.getDataRange().getValues().slice(1)
      .filter(r => String(r[1]).trim())
      .map(r => ({ name:String(r[0]).trim(), code:String(r[1]).trim() }));
    cache.put("classes", JSON.stringify(list), 600);
  }
  const hit = list.find(c => c.code === code);
  if(hit) return hit;
  // 예전 서버처럼 스크립트 속성 CLASS_CODE로 정한 수업 코드도 받아 줌
  const old = PropertiesService.getScriptProperties().getProperty("CLASS_CODE");
  return old && String(old).trim() === code ? { name:"Q-메이커스", code } : null;
}

/* ===== 저장: 캐시에서 빠르게 읽고, 시트에 늘 저장 ===== */
function loadRow_(sheetName, key1, key2, blank){
  const k = sheetName + ":" + key1 + ":" + key2, cache = CacheService.getScriptCache();
  const hit = cache.get(k);
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  const sh = sheet_(sheetName, ["반 코드", "모둠·학생", "상태(JSON)", "저장 시각"]);
  const row = findRow_(sh, key1, key2);
  let obj = blank;
  if(row){ try{ obj = JSON.parse(sh.getRange(row, 3).getValue() || "null") || blank; }catch(e){} }
  cache.put(k, JSON.stringify(obj), CACHE_SEC);
  return obj;
}
function saveRow_(sheetName, key1, key2, obj){
  const json = JSON.stringify(obj);
  CacheService.getScriptCache().put(sheetName + ":" + key1 + ":" + key2, json, CACHE_SEC);
  const sh = sheet_(sheetName, ["반 코드", "모둠·학생", "상태(JSON)", "저장 시각"]);
  const row = findRow_(sh, key1, key2);
  if(row) sh.getRange(row, 3, 1, 2).setValues([[json, new Date()]]);
  else sh.appendRow([key1, key2, json, new Date()]);
}
function findRow_(sh, key1, key2){
  const n = sh.getLastRow(); if(n < 2) return 0;
  const vals = sh.getRange(2, 1, n - 1, 2).getValues();
  for(let i = 0; i < vals.length; i++){
    if(String(vals[i][0]) === String(key1) && String(vals[i][1]) === String(key2)) return i + 2;
  }
  return 0;
}
function blank_(){ return norm({ v:0 }); }
function load_(code, moum){ return norm(loadRow_("앱상태", code, moum, blank_())); }
function save_(code, moum, st){ saveRow_("앱상태", code, moum, st); }
function blankP_(){ return { v:0, moum:"", f:{}, notes:{ marks:[], memos:{} } }; }
function loadP_(code, uid){
  const pp = loadRow_("개인상태", code, uid, blankP_());
  pp.v = pp.v || 0; pp.f = pp.f || {}; pp.notes = pp.notes || { marks:[], memos:{} }; pp.moum = pp.moum || "";
  return pp;
}
function saveP_(code, uid, pp){ saveRow_("개인상태", code, uid, pp); }

/* ===== 선생님 화면 연동 상태 ===== */
function getCls_(code){
  const cache = CacheService.getScriptCache(), k = "cls:" + code;
  const hit = cache.get(k);
  if(hit){ try{ return JSON.parse(hit); }catch(e){} }
  let c = null;
  try{ c = JSON.parse(PropertiesService.getScriptProperties().getProperty(k) || "null"); }catch(e){}
  c = c || { live:false, lock:true, open56:false, step:"", seq:0, push:false };
  if(c.lock === undefined) c.lock = true; // 집중 모드는 기본으로 켜 둠
  cache.put(k, JSON.stringify(c), CACHE_SEC);
  return c;
}
function putCls_(code, c){
  const k = "cls:" + code;
  CacheService.getScriptCache().put(k, JSON.stringify(c), CACHE_SEC);
  PropertiesService.getScriptProperties().setProperty(k, JSON.stringify(c));
}

/* ===== 기록 시트 (선생님이 보기 좋게) ===== */
function log_(cls, moum, sid, name, op, st){
  const now = new Date();
  const who = sid ? name : "선생님";
  if(op.t === "addCard"){
    const c = st.cards.find(x => x.id === op.id); if(!c) return;
    sheet_("질문카드", ["시각", "반", "모둠", "학번", "이름", "질문", "자료", "자료에서 고른 부분"])
      .appendRow([now, cls.name, moum, sid, who, c.text, c.src || "", c.q || ""]);
  }
  if(op.t === "done" && op.done){
    const textOf = id => (st.cards.find(c => c.id === id) || {}).text || "";
    const sh = sheet_("후보탐구질문", ["시각", "반", "모둠", "번호", "후보 탐구 질문", "고른 이유", "바탕이 된 질문", "마지막 AI 판단", "확정한 학생"]);
    st.cands.forEach((k, i) => sh.appendRow([now, cls.name, moum, i + 1, k.text, k.reason, k.from.map(textOf).filter(String).join(" / "), "", who]));
  }
  if(op.t === "done2" && op.done){
    const lsh = sheet_("정교화사다리", ["시각", "반", "모둠", "이름", "출발", "① 개념 연결", "② 범위·대상", "③ 탐구형", "도착(종합)"]);
    const G = st.glad; if(G.start || G.end) lsh.appendRow([now, cls.name, moum, "우리 모둠", G.start, G.c1, G.c2, G.c3, G.end]);
    st.lads.forEach(l => lsh.appendRow([now, cls.name, moum, l.name, l.start, l.c1, l.c2, l.c3, l.end]));
    const ladText = id => { const l = st.lads.find(x => x.id === id); return l ? (l.end || l.c3 || l.c2 || l.c1 || l.start) : ""; };
    const row = [now, cls.name, moum, st.fin.text, st.fin.reason, st.fin.from.map(ladText).filter(String).join(" / ")];
    ["a", "b", "c"].forEach(k => { const s = st.subs[k]; row.push(s.q, s.check, s.src, s.who); });
    row.push(who);
    if(st.subN === 4){ const s = st.subs.d; row.push(s.q, s.check, s.src, s.who); }
    sheet_("2차시탐구계획", ["시각", "반", "모둠", "최종 탐구 질문", "고른 이유", "바탕이 된 질문",
      "하위①실태 질문", "하위① 확인할 것", "하위① 자료·출처", "하위① 담당",
      "하위②원인 질문", "하위② 확인할 것", "하위② 자료·출처", "하위② 담당",
      "하위③영향 질문", "하위③ 확인할 것", "하위③ 자료·출처", "하위③ 담당", "확정한 학생",
      "하위④ 질문", "하위④ 확인할 것", "하위④ 자료·출처", "하위④ 담당"]).appendRow(row);
  }
  if(op.t === "done3" && op.done){
    const row = [now, cls.name, moum, st.fin.text];
    ["a", "b", "c"].forEach(k => { const s = st.subs[k], r = st.res[k];
      row.push(s.q, s.who, r.data, r.src, r.interp, r.fb.map(x => (x.tag ? "[" + x.tag + "] " : "") + x.text + (x.done ? " (반영)" : "")).join(" / "), r.fix); });
    row.push(st.concl.answer, st.concl.evidence, st.concl.more, who);
    if(st.subN === 4){ const s = st.subs.d, r = st.res.d; row.push(s.q, s.who, r.data, r.src, r.interp, r.fb.map(x => (x.tag ? "[" + x.tag + "] " : "") + x.text + (x.done ? " (반영)" : "")).join(" / "), r.fix); }
    else row.push("", "", "", "", "", "", "");
    ["a", "b", "c", "d"].forEach(k => row.push(st.res[k].ai));
    const h = ["시각", "반", "모둠", "탐구 질문"];
    ["①", "②", "③"].forEach(n => h.push("하위" + n + " 질문", "하위" + n + " 담당", "하위" + n + " 조사 내용", "하위" + n + " 출처", "하위" + n + " 해석", "하위" + n + " 보완 의견", "하위" + n + " 수정"));
    h.push("답변", "핵심 근거", "더 확인하고 싶은 점", "확정한 학생", "하위④ 질문", "하위④ 담당", "하위④ 조사 내용", "하위④ 출처", "하위④ 해석", "하위④ 보완 의견", "하위④ 수정", "하위① AI 활용", "하위② AI 활용", "하위③ AI 활용", "하위④ AI 활용");
    sheet_("3차시탐구문서", h).appendRow(row);
  }
}
function logSubmit_(cls, moum, sid, name, f, pp){
  const v = k => pp.f[k] || "";
  const base = [new Date(), cls.name, moum, sid, name];
  if(f === "s4sub"){
    const memo = [1, 2, 3, 4, 5].map(i => v("s4c" + i + "t") ? "(" + v("s4c" + i + "m") + "모둠) " + v("s4c" + i + "t") : "").filter(String).join(" / ");
    sheet_("4차시배움정리", ["시각", "반", "모둠", "학번", "이름", "처음 떠올렸던 질문", "깊어진 생각", "새롭게 떠오른 질문", "종합 질문 답변", "댓글 메모"])
      .appendRow(base.concat([v("s4first"), v("s4deep"), v("s4new"), v("s4synth"), memo]));
  }
  if(f === "s5sub"){
    sheet_("탐구계획서", ["제출 시각", "반", "모둠", "학번", "이름", "진로 분야", "이유", "사례 제목", "출처", "핵심 사실", "쏟아낸 질문", "출발 질문", "① 개념", "② 범위·대상", "③ 탐구형",
      "나의 탐구 질문", "공간 불평등인 이유", "하위① 실태", "하위① 찾을 자료", "하위② 원인", "하위② 찾을 자료", "하위③ 영향", "하위③ 찾을 자료", "탐구 일정", "해결 질문(제도)", "제도적 방안", "해결 질문(시민)", "시민 실천 방안",
      "생활의 필요", "기회·부담의 차이", "구조적 원인", "탐구 대상", "탐구 지역", "기준 연도", "선생님께"])
      .appendRow(base.concat([v("s5career"), v("s5why"), v("s5title"), v("s5source"), v("s5facts"), v("s5qs"), v("s5start"), v("s5c1"), v("s5c2"), v("s5c3"),
        v("s5myq"), v("s5reason"), v("s5h1"), v("s5h1s"), v("s5h2"), v("s5h2s"), v("s5h3"), v("s5h3s"),
        [1, 2, 3, 4].map(i => v("s5d" + i) || v("s5t" + i) ? v("s5d" + i) + " " + v("s5t" + i) : "").filter(String).join(" / "), v("s5q2"), v("s5inst"), v("s5q3"), v("s5civic"),
        v("s5n1"), v("s5n2"), v("s5n3"), v("s5who"), v("s5where"), v("s5year"), v("s5ask")]));
  }
  if(f === "s6sub"){
    sheet_("정책제안서", ["제출 시각", "반", "모둠", "학번", "이름", "제안서 제목", "1 현상 및 문제 진단", "2 제도적 방안", "3 시민 실천 방안", "4 진로와의 연결", "글자 수",
      "하위① 조사 내용", "하위① 출처", "하위① 해석", "하위② 조사 내용", "하위② 출처", "하위② 해석", "하위③ 조사 내용", "하위③ 출처", "하위③ 해석"])
      .appendRow(base.concat([v("s6title"), v("s6a1"), v("s6a2"), v("s6a3"), v("s6a4"), (v("s6a1") + v("s6a2") + v("s6a3") + v("s6a4")).length,
        v("s6r1d"), v("s6r1s"), v("s6r1i"), v("s6r2d"), v("s6r2s"), v("s6r2i"), v("s6r3d"), v("s6r3s"), v("s6r3i")]));
  }
}

/* ===== 선생님이 편집기에서 직접 실행하는 함수 ===== */
/** 연습용 수업 코드(PRACTICE_CODE)의 모둠 기록·개인 기록과 화면 연동을 비움 */
function resetPractice(){
  const code = PRACTICE_CODE;
  for(let m = 1; m <= MOUMS; m++) save_(code, String(m), blank_());
  const sh = book_().getSheetByName("개인상태");
  if(sh && sh.getLastRow() >= 2){
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for(let i = vals.length - 1; i >= 0; i--){
      if(String(vals[i][0]) === code){ CacheService.getScriptCache().remove("개인상태:" + code + ":" + vals[i][1]); sh.deleteRow(i + 2); }
    }
  }
  putCls_(code, { live:false, lock:true, open56:false, step:"", seq:0, push:false });
  CacheService.getScriptCache().remove("classes");
}
/** 반목록 시트를 고친 뒤 바로 반영하고 싶을 때 */
function refreshClasses(){ CacheService.getScriptCache().remove("classes"); }

/* ===== 공통 규칙 시작 — Code.gs와 글자 하나까지 같아야 함 ===== */
function norm(st){
  st.v = st.v || 0;
  st.cards = st.cards || []; st.groups = st.groups || []; st.cands = st.cands || []; st.done = !!st.done;
  st.lads = st.lads || [];
  st.glad = st.glad || {}; ["cand", "start", "c1", "c2", "c3", "end"].forEach(f => { st.glad[f] = st.glad[f] || ""; }); st.glad.ok = !!st.glad.ok;
  st.fin = st.fin || {};
  st.fin.text = st.fin.text || ""; st.fin.reason = st.fin.reason || ""; st.fin.from = st.fin.from || [];
  st.fin.chk = st.fin.chk || [false, false, false, false];
  st.fin.ok = !!st.fin.ok;
  st.subs = st.subs || {};
  ["a", "b", "c"].forEach(k => { st.subs[k] = st.subs[k] || {}; ["q", "check", "src", "who"].forEach(f => { st.subs[k][f] = st.subs[k][f] || ""; }); });
  st.subChk = st.subChk || [false, false, false];
  st.done2 = !!st.done2;
  st.res = st.res || {};
  ["a", "b", "c"].forEach(k => { const r = st.res[k] = st.res[k] || {}; ["data", "src", "interp", "fix", "ai"].forEach(f => { r[f] = r[f] || ""; }); r.fb = r.fb || []; });
  st.concl = st.concl || {}; ["answer", "evidence", "more"].forEach(f => { st.concl[f] = st.concl[f] || ""; });
  st.pres = st.pres || {}; ["p1", "p2", "p3", "w1", "w2", "w3"].forEach(f => { st.pres[f] = st.pres[f] || ""; });
  st.done3 = !!st.done3;
  st.subN = st.subN === 4 ? 4 : 3;
  st.subs.d = st.subs.d || {}; ["q", "check", "src", "who"].forEach(f => { st.subs.d[f] = st.subs.d[f] || ""; });
  const rd = st.res.d = st.res.d || {}; ["data", "src", "interp", "fix", "ai"].forEach(f => { rd[f] = rd[f] || ""; }); rd.fb = rd.fb || [];
  st.cmts = st.cmts || [];
  st.mem = st.mem || [];
  return st;
}
function applyOp(st, op){
  norm(st);
  const cut = (s, n) => String(s == null ? "" : s).slice(0, n);
  const card = id => st.cards.find(x => x.id === id);
  const cand = id => st.cands.find(k => k.id === id);
  const lad = id => st.lads.find(l => l.id === id);
  const prune = () => { st.groups = st.groups.filter(g => st.cards.some(c => c.g === g.id)); };
  const K3 = st.subN === 4 ? ["a", "b", "c", "d"] : ["a", "b", "c"];
  switch(op.t){
    case "addCard": if(!card(op.id) && st.cards.length < 400) st.cards.push({ id:op.id, name:op.name, text:cut(op.text, 200), g:"", src:cut(op.src, 20), q:cut(op.q, 80) }); break;
    case "delCard": { const n = st.cards.length; st.cards = st.cards.filter(x => !(x.id === op.id && x.name === op.name));
      if(st.cards.length !== n){ st.cands.forEach(k => { k.from = k.from.filter(f => f !== op.id); }); prune(); } break; }
    case "move": { const x = card(op.id); if(x) x.g = cut(op.g, 40); prune(); break; }
    case "moveMany": (op.ids || []).slice(0, 100).forEach(i => { const x = card(i); if(x) x.g = cut(op.g, 40); }); prune(); break;
    case "group": if(!st.groups.find(g => g.id === op.id) && st.groups.length < 30){
      st.groups.push({ id:op.id, name:"" }); (op.ids || []).slice(0, 100).forEach(i => { const x = card(i); if(x) x.g = op.id; }); prune(); } break;
    case "addGroup": if(!st.groups.find(g => g.id === op.id) && st.groups.length < 30) st.groups.push({ id:op.id, name:cut(op.name, 30) }); break;
    case "renameGroup": { const g = st.groups.find(g => g.id === op.id); if(g) g.name = cut(op.name, 30); break; }
    case "delGroup": st.groups = st.groups.filter(g => g.id !== op.id);
      st.cards.forEach(x => { if(x.g === op.id) x.g = ""; }); break;
    case "addCand": if(st.cands.length < 3 && !cand(op.id)) st.cands.push({ id:op.id, text:cut(op.text, 200), reason:"", from:(op.from || []).slice(0, 10) }); break;
    case "editCand": { const k = cand(op.id); if(!k) break;
      if(op.text !== undefined) k.text = cut(op.text, 200);
      if(op.reason !== undefined) k.reason = cut(op.reason, 300); break; }
    case "addFrom": { const k = cand(op.id); if(k && card(op.card) && !k.from.includes(op.card)) k.from.push(op.card); break; }
    case "delFrom": { const k = cand(op.id); if(k) k.from = k.from.filter(f => f !== op.card); break; }
    case "delCand": st.cands = st.cands.filter(k => k.id !== op.id); break;
    case "done": st.done = !!op.done; break;
    case "addLad": if(!lad(op.id) && st.lads.length < 30) st.lads.push({ id:op.id, name:op.name, cand:cut(op.cand, 40), start:cut(op.start, 200), c1:"", c2:"", c3:"", end:"" }); break;
    case "editLad": { const l = lad(op.id); if(l && l.name === op.name && ["start", "c1", "c2", "c3", "end"].includes(op.f)) l[op.f] = cut(op.val, 200); break; }
    case "gladPick": st.glad = { cand:cut(op.cand, 40), start:cut(op.start, 200), c1:"", c2:"", c3:"", end:"" }; break;
    case "glad": if(!st.glad.ok && ["start", "c1", "c2", "c3", "end"].includes(op.f)) st.glad[op.f] = cut(op.val, 200); break;
    case "gladOk": st.glad.ok = !!op.val && st.glad.end.trim().length > 0; break;
    case "finOk": st.fin.ok = !!op.val && st.fin.text.trim().length > 0; break;
    case "delLad": st.lads = st.lads.filter(l => !(l.id === op.id && l.name === op.name));
      st.fin.from = st.fin.from.filter(f => lad(f)); break;
    case "fin": if(st.fin.ok) break; if(op.f === "text" || op.f === "reason") st.fin[op.f] = cut(op.val, 300);
      if(Array.isArray(op.from)) st.fin.from = op.from.filter(f => lad(f)).slice(0, 5); break;
    case "finFrom": if(lad(op.lad) && !st.fin.from.includes(op.lad) && st.fin.from.length < 5) st.fin.from.push(op.lad); break;
    case "finChk": if(!st.fin.ok && op.i >= 0 && op.i < 4) st.fin.chk[op.i] = !!op.val; break;
    case "sub": if(K3.includes(op.k) && ["q", "check", "src", "who"].includes(op.f)) st.subs[op.k][op.f] = cut(op.val, 200); break;
    case "subChk": if(op.i >= 0 && op.i < 3) st.subChk[op.i] = !!op.val; break;
    case "done2": st.done2 = !!op.done; break;
    case "res": if(K3.includes(op.k) && ["data", "src", "interp", "fix", "ai"].includes(op.f)) st.res[op.k][op.f] = cut(op.val, 1000); break;
    case "addFb": if(K3.includes(op.k) && st.res[op.k].fb.length < 40 && !st.res[op.k].fb.find(x => x.id === op.id))
      st.res[op.k].fb.push({ id:op.id, name:op.name, tag:cut(op.tag, 20), text:cut(op.text, 300) }); break;
    case "delFb": if(K3.includes(op.k)) st.res[op.k].fb = st.res[op.k].fb.filter(x => !(x.id === op.id && x.name === op.name)); break;
    case "fbDone": if(K3.includes(op.k)){ const x = st.res[op.k].fb.find(f => f.id === op.id); if(x) x.done = !!op.val; } break;
    case "concl": if(["answer", "evidence", "more"].includes(op.f)) st.concl[op.f] = cut(op.val, 1000); break;
    case "pres": if(["p1", "p2", "p3"].includes(op.f)) st.pres[op.f] = cut(op.val, 300);
      if(["w1", "w2", "w3"].includes(op.f)) st.pres[op.f] = cut(op.val, 40); break;
    case "done3": st.done3 = !!op.done; break;
    case "subN": st.subN = op.n === 4 ? 4 : 3; break;
    case "addCmt": if(st.cmts.length < 300 && !st.cmts.find(x => x.id === op.id))
      st.cmts.push({ id:op.id, name:op.name, from:cut(op.from, 4), kind:cut(op.kind, 8), text:cut(op.text, 300) }); break;
    case "delCmt": st.cmts = st.cmts.filter(x => !(x.id === op.id && x.name === op.name)); break;
  }
  return st;
}
/* ===== 공통 규칙 끝 ===== */
