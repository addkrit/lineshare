/**
 * LINE Share — แชร์ Flex Message ต่อกันไม่มีที่สิ้นสุด + เก็บโปรไฟล์ LINE ลง Google Sheet
 *
 * ทำงานยังไง
 *  1) ส่งลิงก์ https://liff.line.me/<LIFF_ID> ให้ลูกค้า → กดแล้ว LINE ขอให้ยินยอม (ล็อกอิน)
 *  2) หน้าเว็บส่ง ID token มาที่นี่ → ตรวจกับ LINE ว่าของจริง → บันทึก/อัปเดตแถวในแท็บ members
 *  3) ตอบกลับ Flex ของแคมเปญ ที่แทนค่า {{name}} {{picture}} {{shareUrl}} ... เป็นของคนนั้น
 *  4) คนนั้นกด "แชร์ต่อ" → เพื่อนได้ Flex ที่มีลิงก์ของเขา (r=รหัสแนะนำ) → เพื่อนกด → วนข้อ 1 ไม่สิ้นสุด
 *     ทุกคนรู้ว่าใครชวนใคร (ผู้ชวน, ชั้นที่, ชวนสำเร็จกี่คน)
 *
 * ติดตั้ง: ดู README-TH.md — ใส่ LIFF_ID + SHEET_ID ด้านล่าง > Run setup > Deploy เว็บแอป (ฉัน / ทุกคน)
 */

// ===== ตั้งค่า =====
const LIFF_ID = '2012679146-P193zTHk';    // LIFF "CeeShop Share" (Provider: CeeShop Share)
const SHEET_ID = '1yTFPV0wpK8iqV8P6kKU-b1QrqPw1baX9pmKprjhzPww';   // Google Sheet "LINE Share DB" (goimage55)
const PAGE_URL = 'https://addkrit.github.io/lineshare/';  // ที่อยู่หน้าเว็บ (ใช้หารูปสำรอง)

// ===== ค่าคงที่ (ไม่ต้องแก้) =====
const TZ = 'Asia/Bangkok';
const DEFAULT_AVATAR = PAGE_URL + 'user.png';
const T_MEMBERS = 'members', T_EVENTS = 'events', T_CAMPAIGNS = 'campaigns', T_ADMINS = 'admins';
const M = {
  UID: 1, NAME: 2, PIC: 3, STATUS: 4, EMAIL: 5, LANG: 6, OS: 7, VER: 8, FRIEND: 9, CTX: 10,
  REF: 11, BY_ID: 12, BY_NAME: 13, CAMP: 14, SRC: 15, FIRST: 16, LAST: 17, VISITS: 18,
  SHARES: 19, INVITED: 20, LEVEL: 21,
};
const M_W = 21;
const M_HEAD = ['userId', 'ชื่อ LINE', 'รูปโปรไฟล์', 'สเตตัส', 'อีเมล', 'ภาษา', 'มือถือ (OS)', 'LINE เวอร์ชัน',
  'เป็นเพื่อน OA', 'เปิดจาก', 'รหัสแนะนำ', 'ผู้ชวน (userId)', 'ผู้ชวน (ชื่อ)', 'แคมเปญแรก', 'แหล่งที่มา',
  'ลงทะเบียน', 'เข้าล่าสุด', 'เข้า (ครั้ง)', 'แชร์ (ครั้ง)', 'ชวนสำเร็จ (คน)', 'ชั้นที่'];
const E_HEAD = ['เวลา', 'userId', 'ชื่อ', 'การกระทำ', 'แคมเปญ', 'ผู้ชวน (userId)', 'รายละเอียด'];
const C = { ID: 1, NAME: 2, ALT: 3, ACTIVE: 4, JOINED: 5, SHARES: 6, CREATED: 7, UPDATED: 8, NOTE: 9, JSON: 10 };
const C_HEAD = ['id', 'ชื่อแคมเปญ', 'ข้อความแจ้งเตือน (altText)', 'เปิดใช้', 'คนเข้าร่วม', 'แชร์ (ครั้ง)',
  'สร้าง', 'แก้ไขล่าสุด', 'หมายเหตุ', 'Flex JSON (แบ่งหลายช่อง แก้ในหน้าแอดมินเท่านั้น)'];
const A_HEAD = ['userId', 'ชื่อ', 'เพิ่มเมื่อ'];
const CHUNK = 40000;   // ตัวอักษรต่อช่อง (Sheet รับได้ 50,000)
const P = '~';         // prefix ของ JSON ในช่อง กัน Sheet แปลงเป็นสูตร
const SESSION_HOURS = 12;

// ---------- ทางเข้า ----------
function doGet() {
  return out_({ ok: true, app: 'LINE Share', liff: LIFF_ID ? 'set' : 'missing' });
}

function doPost(e) {
  let res;
  try {
    const raw = (e && e.parameter && e.parameter.p) || (e && e.postData && e.postData.contents) || '{}';
    res = route_(JSON.parse(raw));
  } catch (err) {
    res = { ok: false, code: (err && err.code) || 'error', error: String((err && err.message) || err) };
  }
  return out_(res);
}

function route_(p) {
  if (!LIFF_ID || !SHEET_ID) throw new Error('ยังไม่ได้ใส่ LIFF_ID / SHEET_ID ใน Code.gs');
  switch (p.action) {
    case 'join': return join_(p);
    case 'share': return share_(p);
    case 'render': return renderFor_(p);
    case 'adminClaim': return adminClaim_(p);
    case 'adminStats': return adminStats_(p);
    case 'campaigns': return campaignList_(p);
    case 'campaignSave': return campaignSave_(p);
    case 'campaignDelete': return campaignDelete_(p);
    default: throw new Error('คำสั่งไม่ถูกต้อง: ' + p.action);
  }
}

// ---------- ยืนยันตัวตน ----------
function fail_(msg, code) { const e = new Error(msg); e.code = code || 'error'; return e; }

// ตรวจ ID token กับ LINE (ของจริง ไม่ใช่ปลอม) → { sub, name, picture, email }
function verifyIdToken_(idToken) {
  if (!idToken) throw fail_('ไม่มี ID token — เปิด scope "openid" ใน LIFF แล้วล็อกอินใหม่', 'auth');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: String(LIFF_ID).split('-')[0] },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.sub) {
    throw fail_('ยืนยันตัวตนไม่ผ่าน (' + (body.error_description || body.error || res.getResponseCode()) + ')', 'auth');
  }
  return body;
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', s); }
  return s;
}
function sign_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())).replace(/=+$/, '');
}
function makeSession_(uid) {
  const body = uid + '.' + (Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600);
  return body + '.' + sign_(body);
}
// session = ตั๋วที่เราเซ็นเอง (ไม่ต้องถาม LINE ซ้ำทุกครั้ง ประหยัดโควตา)
function checkSession_(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3 || sign_(parts[0] + '.' + parts[1]) !== parts[2]) throw fail_('เซสชันไม่ถูกต้อง — เปิดหน้าใหม่', 'auth');
  if (Number(parts[1]) < Date.now() / 1000) throw fail_('เซสชันหมดเวลา — เปิดหน้าใหม่', 'auth');
  return parts[0];
}

// ---------- Sheet ----------
let SS_ = null;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(SHEET_ID)); }
function tab_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    const head = { members: M_HEAD, events: E_HEAD, campaigns: C_HEAD, admins: A_HEAD }[name];
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e8f5e9');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ข้อความจากผู้ใช้: กันไม่ให้ Sheet ตีความเป็นสูตร (=,+,-,@) หรือเป็นตัวเลข
function txt_(v) {
  v = String(v == null ? '' : v).slice(0, 1000);
  return /^[=+\-@\d]/.test(v) ? "'" + v : v;
}

function findRow_(sh, col, value) {
  const last = sh.getLastRow();
  if (!value || last < 2) return 0;
  const hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findNext();
  return hit ? hit.getRow() : 0;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function rand_(n) {
  const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}

function logEvent_(uid, name, action, campId, byId, detail) {
  tab_(T_EVENTS).appendRow([new Date(), uid, txt_(name), action, campId || '', byId || '', txt_(detail || '')]);
}

function shareUrl_(campId, ref) {
  return 'https://liff.line.me/' + LIFF_ID + '?c=' + encodeURIComponent(campId) + '&r=' + encodeURIComponent(ref);
}

// ---------- แคมเปญ ----------
function un_(v) { v = String(v == null ? '' : v); return v.charAt(0) === P ? v.slice(1) : v; }

function campaigns_() {
  const sh = tab_(T_CAMPAIGNS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(sh.getLastColumn(), C.JSON);
  return sh.getRange(2, 1, last - 1, width).getValues().map(function (r, i) {
    let json = '';
    for (let c = C.JSON - 1; c < r.length; c++) {
      if (r[c] === '' || r[c] == null) break;
      json += un_(r[c]);
    }
    return {
      row: i + 2, id: String(r[C.ID - 1]), name: String(r[C.NAME - 1]), altText: String(r[C.ALT - 1]),
      active: r[C.ACTIVE - 1] === true || String(r[C.ACTIVE - 1]).toUpperCase() === 'TRUE',
      joined: Number(r[C.JOINED - 1]) || 0, shares: Number(r[C.SHARES - 1]) || 0,
      updated: r[C.UPDATED - 1], note: String(r[C.NOTE - 1] || ''), json: json,
    };
  }).filter(function (c) { return c.id; });
}

// แคมเปญตาม id (ถ้าไม่ระบุ/ไม่พบ → แคมเปญแรกที่เปิดใช้)
function pickCampaign_(id) {
  const all = campaigns_();
  if (id) {
    const hit = all.filter(function (c) { return c.id === String(id); })[0];
    if (hit && hit.active) return hit;
    if (hit && !hit.active) throw new Error('แคมเปญนี้ปิดไปแล้ว');
  }
  const first = all.filter(function (c) { return c.active; })[0];
  if (!first) throw new Error('ยังไม่มีแคมเปญที่เปิดใช้');
  return first;
}

function bump_(sh, row, col, by) {
  const cell = sh.getRange(row, col);
  const v = (Number(cell.getValue()) || 0) + (by || 1);
  cell.setValue(v);
  return v;
}

// แทนค่าตัวแปรใน Flex ให้เป็นของคนแชร์ แล้วคืนข้อความ Flex พร้อมส่ง
function render_(camp, me) {
  const url = shareUrl_(camp.id, me.ref);
  const vals = {
    name: me.name || 'เพื่อน', picture: me.picture || DEFAULT_AVATAR, shareUrl: url,
    campaign: camp.name, members: camp.joined, invited: me.invited || 0, shares: me.shares || 0,
    date: Utilities.formatDate(new Date(), TZ, 'd/M/yyyy'),
  };
  const esc = function (s) { return JSON.stringify(String(s)).slice(1, -1); };
  const s = String(camp.json).replace(/\{\{(\w+)\}\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(vals, k) ? esc(vals[k]) : m;
  });
  let contents = JSON.parse(s);
  if (contents.type === 'flex' && contents.contents) contents = contents.contents;
  if (String(camp.json).indexOf('{{shareUrl}}') < 0) addShareButton_(contents, url);
  const alt = String(camp.altText || '{{name}} ส่งข้อความถึงคุณ').replace(/\{\{(\w+)\}\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(vals, k) ? String(vals[k]) : m;
  }).slice(0, 400);
  return { type: 'flex', altText: alt, contents: contents };
}

// ถ้า Flex ไม่มีปุ่ม {{shareUrl}} → เติมปุ่ม "แชร์ต่อ" ท้ายทุก bubble ให้อัตโนมัติ (สายแชร์ไม่ขาด)
function addShareButton_(contents, url) {
  const bubbles = contents.type === 'carousel' ? (contents.contents || []) : [contents];
  bubbles.forEach(function (b) {
    const btn = { type: 'button', style: 'primary', color: '#06C755', height: 'sm',
      action: { type: 'uri', label: 'แชร์ต่อให้เพื่อน', uri: url } };
    if (!b.footer) b.footer = { type: 'box', layout: 'vertical', spacing: 'sm', contents: [btn] };
    else if (Array.isArray(b.footer.contents)) b.footer.contents.push(btn);
  });
}

// ---------- คำสั่งของผู้ใช้ ----------
function join_(p) {
  const tok = verifyIdToken_(p.idToken);
  const uid = tok.sub;
  const camp = pickCampaign_(p.c);
  const info = {
    name: tok.name || p.name || '', picture: tok.picture || p.picture || '', status: p.statusMessage || '',
    email: tok.email || '', lang: p.lang || '', os: p.os || '', ver: p.lineVersion || '',
    friend: p.isFriend || '', ctx: p.contextType || '',
  };
  const result = withLock_(function () {
    const sh = tab_(T_MEMBERS);
    const now = new Date();
    let row = findRow_(sh, M.UID, uid);
    let isNew = false, by = null;
    const infoRow = [txt_(info.name), txt_(info.picture), txt_(info.status), txt_(info.email), txt_(info.lang),
      txt_(info.os), txt_(info.ver), txt_(info.friend), txt_(info.ctx)];
    if (row) {
      // คนเดิม: อัปเดตโปรไฟล์ (ไม่ทับอีเมลเดิมด้วยค่าว่าง) + เวลาเข้าล่าสุด + จำนวนครั้ง
      if (!info.email) infoRow[3] = txt_(sh.getRange(row, M.EMAIL).getValue());
      sh.getRange(row, M.NAME, 1, infoRow.length).setValues([infoRow]);
      sh.getRange(row, M.LAST).setValue(now);
      bump_(sh, row, M.VISITS);
    } else {
      isNew = true;
      let level = 1;
      const refRow = findRow_(sh, M.REF, p.r);
      if (refRow) {
        const rv = sh.getRange(refRow, 1, 1, M_W).getValues()[0];
        if (rv[M.UID - 1] !== uid) {
          by = { id: rv[M.UID - 1], name: rv[M.NAME - 1] };
          level = (Number(rv[M.LEVEL - 1]) || 1) + 1;
          bump_(sh, refRow, M.INVITED);
        }
      }
      let ref = rand_(7);
      while (findRow_(sh, M.REF, ref)) ref = rand_(7);
      row = sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, M_W).setValues([[uid].concat(infoRow, [
        txt_(ref), by ? by.id : '', by ? txt_(by.name) : '', camp.id, txt_(p.src || ''), now, now, 1, 0, 0, level])]);
      camp.joined = bump_(tab_(T_CAMPAIGNS), camp.row, C.JOINED);
    }
    const v = sh.getRange(row, 1, 1, M_W).getValues()[0];
    logEvent_(uid, info.name, isNew ? 'สมัครใหม่' : 'เข้าอีกครั้ง', camp.id, by ? by.id : '', p.src || '');
    return {
      isNew: isNew,
      me: { name: info.name, picture: info.picture, ref: String(v[M.REF - 1]), invited: Number(v[M.INVITED - 1]) || 0,
        shares: Number(v[M.SHARES - 1]) || 0, level: Number(v[M.LEVEL - 1]) || 1,
        by: by ? by.name : String(v[M.BY_NAME - 1] || '') },
    };
  });
  return {
    ok: true, session: makeSession_(uid), isNew: result.isNew, me: result.me,
    campaign: { id: camp.id, name: camp.name, joined: camp.joined },
    shareUrl: shareUrl_(camp.id, result.me.ref),
    message: render_(camp, result.me),
    admin: isAdmin_(uid),
  };
}

function member_(uid) {
  const sh = tab_(T_MEMBERS);
  const row = findRow_(sh, M.UID, uid);
  if (!row) throw fail_('ไม่พบข้อมูลสมาชิก — เปิดหน้าใหม่', 'auth');
  const v = sh.getRange(row, 1, 1, M_W).getValues()[0];
  return { row: row, name: String(v[M.NAME - 1]), picture: String(v[M.PIC - 1]), ref: String(v[M.REF - 1]),
    invited: Number(v[M.INVITED - 1]) || 0, shares: Number(v[M.SHARES - 1]) || 0 };
}

function share_(p) {
  const uid = checkSession_(p.session);
  const via = p.via === 'chat' ? 'ส่งในแชท' : 'แชร์';
  return withLock_(function () {
    const me = member_(uid);
    const shares = bump_(tab_(T_MEMBERS), me.row, M.SHARES);
    const camp = campaigns_().filter(function (c) { return c.id === String(p.c); })[0];
    if (camp) bump_(tab_(T_CAMPAIGNS), camp.row, C.SHARES);
    logEvent_(uid, me.name, via, p.c, '', p.count ? 'ส่งถึง ' + p.count : '');
    return { ok: true, shares: shares };
  });
}

// Flex ของแคมเปญที่เลือก (ในชื่อของคนที่ล็อกอินอยู่) — ใช้ตอนแอดมินทดสอบ
function renderFor_(p) {
  const uid = checkSession_(p.session);
  const camp = p.c ? campaigns_().filter(function (c) { return c.id === String(p.c); })[0] : pickCampaign_('');
  if (!camp) throw new Error('ไม่พบแคมเปญ');
  return { ok: true, message: render_(camp, member_(uid)), shareUrl: shareUrl_(camp.id, member_(uid).ref) };
}

// ---------- แอดมิน ----------
function isAdmin_(uid) { return findRow_(tab_(T_ADMINS), 1, uid) > 0; }
function requireAdmin_(p) {
  const uid = checkSession_(p.session);
  if (!isAdmin_(uid)) throw fail_('ต้องเป็นแอดมิน', 'admin');
  return uid;
}

// ใส่รหัสแอดมิน (ดูได้จาก Run showAdminCode ใน Apps Script) → เพิ่มตัวเองเป็นแอดมิน
function adminClaim_(p) {
  const uid = checkSession_(p.session);
  const cache = CacheService.getScriptCache();
  const k = 'claim_' + uid;
  const tries = Number(cache.get(k)) || 0;
  if (tries >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง ลองใหม่ใน 1 ชั่วโมง');
  const code = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!code || String(p.code || '').trim() !== code) {
    cache.put(k, String(tries + 1), 3600);
    throw new Error('รหัสแอดมินไม่ถูกต้อง');
  }
  return withLock_(function () {
    if (!isAdmin_(uid)) tab_(T_ADMINS).appendRow([uid, txt_(member_(uid).name), new Date()]);
    return { ok: true };
  });
}

function adminStats_(p) {
  requireAdmin_(p);
  const sh = tab_(T_MEMBERS);
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, M_W).getValues();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  let newToday = 0, maxLevel = 0, friends = 0;
  rows.forEach(function (r) {
    const f = r[M.FIRST - 1];
    if (f instanceof Date && Utilities.formatDate(f, TZ, 'yyyy-MM-dd') === today) newToday++;
    maxLevel = Math.max(maxLevel, Number(r[M.LEVEL - 1]) || 0);
    if (r[M.FRIEND - 1] === 'ใช่') friends++;
  });
  const person = function (r) {
    return { name: String(r[M.NAME - 1]), picture: String(r[M.PIC - 1]), invited: Number(r[M.INVITED - 1]) || 0,
      shares: Number(r[M.SHARES - 1]) || 0, level: Number(r[M.LEVEL - 1]) || 1, by: String(r[M.BY_NAME - 1] || ''),
      first: r[M.FIRST - 1] instanceof Date ? Utilities.formatDate(r[M.FIRST - 1], TZ, 'd/M HH:mm') : '' };
  };
  const top = rows.slice().sort(function (a, b) { return (Number(b[M.INVITED - 1]) || 0) - (Number(a[M.INVITED - 1]) || 0); })
    .filter(function (r) { return Number(r[M.INVITED - 1]) > 0; }).slice(0, 10).map(person);
  const latest = rows.slice(-10).reverse().map(person);
  const camps = campaigns_();
  return {
    ok: true, members: rows.length, newToday: newToday, friends: friends, maxLevel: maxLevel,
    shares: camps.reduce(function (s, c) { return s + c.shares; }, 0), top: top, latest: latest,
  };
}

function campaignList_(p) {
  requireAdmin_(p);
  return {
    ok: true,
    data: campaigns_().map(function (c) {
      return { id: c.id, name: c.name, altText: c.altText, active: c.active, joined: c.joined, shares: c.shares,
        note: c.note, json: c.json, link: 'https://liff.line.me/' + LIFF_ID + '?c=' + c.id,
        updated: c.updated instanceof Date ? Utilities.formatDate(c.updated, TZ, 'd/M/yyyy HH:mm') : '' };
    }),
  };
}

function cleanJson_(json) {
  let obj;
  try { obj = JSON.parse(String(json || '')); } catch (e) { throw new Error('Flex JSON ไม่ถูกต้อง: ' + e.message); }
  if (obj.type === 'flex' && obj.contents) obj = obj.contents;
  if (obj.type !== 'bubble' && obj.type !== 'carousel') throw new Error('JSON ต้องเป็น bubble หรือ carousel');
  const s = JSON.stringify(obj);
  if (s.length > 100000) throw new Error('Flex ใหญ่เกินไป');
  return s;
}

function campaignSave_(p) {
  requireAdmin_(p);
  const name = String(p.name || '').trim().slice(0, 100);
  if (!name) throw new Error('กรุณาใส่ชื่อแคมเปญ');
  const json = cleanJson_(p.json);
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(P + json.slice(i, i + CHUNK));
  return withLock_(function () {
    const sh = tab_(T_CAMPAIGNS);
    const now = new Date();
    let id = String(p.id || '');
    let row = id ? findRow_(sh, C.ID, id) : 0;
    if (id && !row) throw new Error('ไม่พบแคมเปญ ' + id);
    if (!row) {
      do { id = 'c' + rand_(5); } while (findRow_(sh, C.ID, id));
      row = sh.getLastRow() + 1;
      sh.getRange(row, C.ID, 1, C.NOTE).setValues([[id, txt_(name), txt_(p.altText || ''), !!p.active, 0, 0, now, now, txt_(p.note || '')]]);
    } else {
      sh.getRange(row, C.NAME, 1, 3).setValues([[txt_(name), txt_(p.altText || ''), !!p.active]]);
      sh.getRange(row, C.UPDATED, 1, 2).setValues([[now, txt_(p.note || '')]]);
    }
    const width = sh.getLastColumn();
    if (width >= C.JSON) sh.getRange(row, C.JSON, 1, width - C.JSON + 1).clearContent();
    sh.getRange(row, C.JSON, 1, parts.length).setValues([parts]);
    return { ok: true, id: id };
  });
}

function campaignDelete_(p) {
  requireAdmin_(p);
  return withLock_(function () {
    const sh = tab_(T_CAMPAIGNS);
    const row = findRow_(sh, C.ID, p.id);
    if (!row) throw new Error('ไม่พบแคมเปญ');
    sh.deleteRow(row);
    return { ok: true };
  });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- ติดตั้ง ----------
// กด Run ครั้งแรก: สร้างแท็บ + แคมเปญตัวอย่าง + รหัสแอดมิน + ขอสิทธิ์ (Sheet, เชื่อมต่อ LINE)
function setup() {
  if (!SHEET_ID) throw new Error('ใส่ SHEET_ID ก่อน');
  [T_MEMBERS, T_EVENTS, T_CAMPAIGNS, T_ADMINS].forEach(tab_);
  ss_().getSheets().forEach(function (sh) {
    if ([T_MEMBERS, T_EVENTS, T_CAMPAIGNS, T_ADMINS].indexOf(sh.getName()) < 0 && sh.getLastRow() === 0) ss_().deleteSheet(sh);
  });
  if (!campaigns_().length) {
    const sh = tab_(T_CAMPAIGNS);
    const now = new Date();
    sh.getRange(2, 1, 1, C.JSON).setValues([['c1', 'แคมเปญตัวอย่าง', '{{name}} แชร์สิ่งนี้ให้คุณ 👀', true, 0, 0, now, now,
      'ตัวอย่าง — แก้รูป ข้อความ ลิงก์ ได้ในหน้าแอดมิน', P + JSON.stringify(sampleFlex_())]]);
  }
  secret_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_CODE')) props.setProperty('ADMIN_CODE', String(Math.floor(100000 + Math.random() * 900000)));
  UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'post', payload: { id_token: 'x', client_id: '1' }, muteHttpExceptions: true });
  Logger.log('พร้อมแล้ว — รหัสแอดมิน: ' + props.getProperty('ADMIN_CODE') + '  (ต่อไป: ทำให้ใช้งานได้ > เว็บแอป > ฉัน / ทุกคน)');
}

function showAdminCode() {
  Logger.log('รหัสแอดมิน: ' + PropertiesService.getScriptProperties().getProperty('ADMIN_CODE'));
}

function sampleFlex_() {
  return {
    type: 'bubble',
    hero: { type: 'image', url: PAGE_URL + 'sample.jpg', size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
      action: { type: 'uri', uri: 'https://develop-marketing.com' } },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'box', layout: 'horizontal', spacing: 'md', contents: [
        { type: 'box', layout: 'vertical', width: '44px', height: '44px', cornerRadius: '22px', flex: 0, contents: [
          { type: 'image', url: '{{picture}}', size: 'full', aspectMode: 'cover', aspectRatio: '1:1' }] },
        { type: 'box', layout: 'vertical', justifyContent: 'center', contents: [
          { type: 'text', text: '{{name}}', weight: 'bold', size: 'sm', wrap: true },
          { type: 'text', text: 'แชร์สิ่งนี้ให้คุณ', size: 'xs', color: '#888888' }] }] },
      { type: 'text', text: 'ลองดูสิ่งนี้ 👇', weight: 'bold', size: 'xl', wrap: true },
      { type: 'text', text: 'แก้รูป ข้อความ และลิงก์ของการ์ดนี้ได้ในหน้าแอดมิน', size: 'sm', color: '#555555', wrap: true },
      { type: 'text', text: 'ร่วมแชร์แล้ว {{members}} คน', size: 'xs', color: '#06C755' }] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'button', style: 'primary', color: '#06C755', height: 'sm',
        action: { type: 'uri', label: 'เปิดดู', uri: 'https://develop-marketing.com' } },
      { type: 'button', style: 'secondary', height: 'sm',
        action: { type: 'uri', label: 'แชร์ต่อให้เพื่อน', uri: '{{shareUrl}}' } }] },
  };
}

// ---------- รูปโปรไฟล์: ลิงก์รูป → รูปในช่อง (คอลัมน์ V) + ไฟล์รูปใน Google Drive (คอลัมน์ W) ----------
// ทำงานอัตโนมัติทุก 1 นาที (ติดตั้งครั้งเดียว: เลือก installImageTrigger > เรียกใช้)
// เปลี่ยนรูปโปรไฟล์ใหม่ → แปลงใหม่ให้เอง (เทียบกับลิงก์ที่จดไว้ในโน้ตของช่องรูป)
const IMG_COL = 22, FILE_COL = 23;
const IMG_FOLDER = 'LINE Share - รูปโปรไฟล์';
const IMG_BATCH = 25;   // ต่อรอบ (กันทำงานนานเกิน)

function installImageTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processImages') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processImages').timeBased().everyMinutes(1).create();
  processImages();
  tidyImageRows();
  Logger.log('ตั้งเวลาแปลงรูปทุก 1 นาทีแล้ว — ไฟล์อยู่ใน Drive โฟลเดอร์ "' + IMG_FOLDER + '"');
}

function imageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('IMG_FOLDER_ID');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
  }
  const folder = DriveApp.createFolder(IMG_FOLDER);
  props.setProperty('IMG_FOLDER_ID', folder.getId());
  return folder;
}

function processImages() {
  const cache = CacheService.getScriptCache();
  if (cache.get('img_running')) return;
  cache.put('img_running', '1', 300);
  try {
    const sh = tab_(T_MEMBERS);
    if (sh.getRange(1, IMG_COL).getValue() !== 'รูป') {
      sh.getRange(1, IMG_COL, 1, 2).setValues([['รูป', 'ไฟล์รูป (Drive)']]).setFontWeight('bold').setBackground('#e8f5e9');
      sh.setColumnWidth(IMG_COL, 64);
    }
    const last = sh.getLastRow();
    if (last < 2) return;
    const n = last - 1;
    const rows = sh.getRange(2, 1, n, M.PIC).getValues();      // userId, ชื่อ, ลิงก์รูป
    const notes = sh.getRange(2, IMG_COL, n, 1).getNotes();     // ลิงก์ที่แปลงไปแล้ว
    let done = 0;
    for (let i = 0; i < n && done < IMG_BATCH; i++) {
      const url = String(rows[i][M.PIC - 1] || '').trim();
      if (!/^https:\/\//.test(url) || notes[i][0] === url) continue;
      const row = i + 2;
      try {
        convertImage_(sh, row, url, String(rows[i][0]), String(rows[i][M.NAME - 1]));
      } catch (e) {
        sh.getRange(row, IMG_COL).setValue('โหลดรูปไม่ได้').setNote(url);
        sh.getRange(row, FILE_COL).setValue(String(e && e.message || e).slice(0, 200));
      }
      done++;
    }
  } finally {
    cache.remove('img_running');
  }
}

function convertImage_(sh, row, url, uid, name) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('โหลดรูปไม่ได้ (HTTP ' + res.getResponseCode() + ')');
  const blob = res.getBlob();
  const type = String(blob.getContentType() || 'image/jpeg');
  if (type.indexOf('image/') !== 0) throw new Error('ลิงก์นี้ไม่ใช่รูป (' + type + ')');
  const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
  const safeName = String(name || 'user').replace(/[\\\/:*?"<>|#%']/g, '').trim().slice(0, 40) || 'user';
  blob.setName(safeName + '_' + uid + '.' + ext);

  // ไฟล์ใน Drive (รูปเดิมของคนนี้ย้ายลงถังขยะ)
  const folder = imageFolder_();
  const old = folder.searchFiles("title contains '" + uid + "' and trashed = false");
  while (old.hasNext()) old.next().setTrashed(true);
  const file = folder.createFile(blob);
  file.setDescription('LINE ' + uid + ' | ' + url);

  // รูปในช่อง: ใช้รูปขนาด 200px ของ LINE (/large) ฝังเป็น data URL ในชีต — ลิงก์เดิมหมดอายุรูปก็ยังอยู่
  let small = blob;
  if (/line-scdn\.net/.test(url)) {
    try {
      const r2 = UrlFetchApp.fetch(url + '/large', { muteHttpExceptions: true });
      if (r2.getResponseCode() === 200 && String(r2.getBlob().getContentType()).indexOf('image/') === 0) small = r2.getBlob();
    } catch (e) {}
  }
  let img;
  try {
    img = SpreadsheetApp.newCellImage()
      .setSourceUrl('data:' + small.getContentType() + ';base64,' + Utilities.base64Encode(small.getBytes()))
      .setAltTextTitle(String(name || '')).build();
  } catch (e) {
    img = SpreadsheetApp.newCellImage().setSourceUrl(url).setAltTextTitle(String(name || '')).build();
  }
  sh.getRange(row, IMG_COL).setValue(img).setNote(url);
  sh.getRange(row, FILE_COL).setFormula('=HYPERLINK("https://drive.google.com/file/d/' + file.getId() + '/view","เปิดไฟล์รูป")');
  tidyRow_(sh, row);
}

// แถวเตี้ยเท่ากัน 60px (สเตตัสหลายบรรทัดไม่ดันแถวให้สูง) — เห็นรูปพอดีช่อง
function tidyRow_(sh, row) {
  sh.getRange(row, 1, 1, FILE_COL).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('middle');
  sh.setRowHeightsForced(row, 1, 60);
}

function tidyImageRows() {
  const sh = tab_(T_MEMBERS);
  for (let r = 2; r <= sh.getLastRow(); r++) tidyRow_(sh, r);
}
