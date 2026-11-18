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
const T_SETTINGS = 'ตั้งค่า';
const C = { ID: 1, NAME: 2, ALT: 3, ACTIVE: 4, STATUS: 5, LINK: 6, JOINED: 7, SHARES: 8, CREATED: 9, UPDATED: 10, NOTE: 11, JSON: 12 };
const C_HEAD = ['id', 'ชื่อแคมเปญ', 'ข้อความแจ้งเตือน (altText)', 'เปิดใช้', 'สถานะ (ระบบเช็กให้)', 'ลิงก์แคมเปญ',
  'คนเข้าร่วม', 'แชร์ (ครั้ง)', 'สร้าง', 'แก้ไขล่าสุด', 'หมายเหตุ',
  'Flex JSON ← ดับเบิลคลิกช่องก่อนวาง (ยาวเกิน 50,000 ตัวอักษร แบ่งต่อช่องขวาได้)'];
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
    case 'setMain': return setMain_(p);
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
      status: String(r[C.STATUS - 1] || ''), joined: Number(r[C.JOINED - 1]) || 0, shares: Number(r[C.SHARES - 1]) || 0,
      updated: r[C.UPDATED - 1], note: String(r[C.NOTE - 1] || ''), json: json,
    };
  }).filter(function (c) { return c.id; });
}

// ใช้ส่งให้ลูกค้าได้ไหม: เปิดใช้ + สถานะไม่ใช่ ❌ + JSON อ่านได้
function usable_(c) {
  if (!c || !c.active || c.status.indexOf('❌') === 0 || !c.json) return false;
  try { JSON.parse(c.json); return true; } catch (e) { return false; }
}

// แคมเปญหลักของลิงก์เปล่า (แท็บ "ตั้งค่า" ช่อง B2)
function mainCampaignId_() {
  const sh = ss_().getSheetByName(T_SETTINGS);
  return sh ? String(sh.getRange('B2').getValue() || '').trim() : '';
}

// เลือกแคมเปญ: ?c=id ที่ใช้ได้ → ไม่งั้นแคมเปญหลัก (แท็บตั้งค่า) → ไม่งั้นแคมเปญแรกที่ใช้ได้
// แคมเปญที่ปิด/ลบ/JSON เสีย → พาไปแคมเปญหลักแทน (สายแชร์ไม่ขาด)
function pickCampaign_(id) {
  const ok = campaigns_().filter(usable_);
  const find = function (x) { return ok.filter(function (c) { return c.id === String(x); })[0]; };
  const hit = (id && find(id)) || find(mainCampaignId_()) || ok[0];
  if (!hit) throw new Error('ยังไม่มีแคมเปญที่เปิดใช้ (หรือ Flex JSON ผิดทุกแคมเปญ)');
  return hit;
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
  const main = mainCampaignId_();
  return {
    ok: true, main: main,
    data: campaigns_().map(function (c) {
      return { id: c.id, name: c.name, altText: c.altText, active: c.active, joined: c.joined, shares: c.shares,
        note: c.note, json: c.json, link: campaignLink_(c.id), status: c.status, main: c.id === main,
        updated: c.updated instanceof Date ? Utilities.formatDate(c.updated, TZ, 'd/M/yyyy HH:mm') : '' };
    }),
  };
}

function campaignLink_(id) { return 'https://liff.line.me/' + LIFF_ID + '?c=' + encodeURIComponent(id); }

// เขียน JSON ลงช่อง (ยาวเกินแบ่งหลายช่อง ขึ้นต้นด้วย ~ กัน Sheet แปลงเป็นสูตร)
function writeJson_(sh, row, json) {
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(P + json.slice(i, i + CHUNK));
  const width = sh.getLastColumn();
  if (width >= C.JSON) sh.getRange(row, C.JSON, 1, width - C.JSON + 1).clearContent();
  sh.getRange(row, C.JSON, 1, parts.length).setValues([parts]);
}

function campaignSave_(p) {
  requireAdmin_(p);
  const name = String(p.name || '').trim().slice(0, 100);
  if (!name) throw new Error('กรุณาใส่ชื่อแคมเปญ');
  const check = validateFlex_(String(p.json || ''));
  if (!check.ok) throw new Error(check.msg);
  return withLock_(function () {
    const sh = tab_(T_CAMPAIGNS);
    const now = new Date();
    let id = String(p.id || '');
    let row = id ? findRow_(sh, C.ID, id) : 0;
    if (id && !row) throw new Error('ไม่พบแคมเปญ ' + id);
    if (!row) {
      do { id = 'c' + rand_(5); } while (findRow_(sh, C.ID, id));
      row = sh.getLastRow() + 1;
      sh.getRange(row, C.ID, 1, C.NOTE).setValues([[id, txt_(name), txt_(p.altText || ''), !!p.active,
        check.msg, campaignLink_(id), 0, 0, now, now, txt_(p.note || '')]]);
    } else {
      sh.getRange(row, C.NAME, 1, 5).setValues([[txt_(name), txt_(p.altText || ''), !!p.active, check.msg, campaignLink_(id)]]);
      sh.getRange(row, C.UPDATED, 1, 2).setValues([[now, txt_(p.note || '')]]);
    }
    writeJson_(sh, row, check.json);
    tidyCampaignRow_(sh, row);
    return { ok: true, id: id };
  });
}

function setMain_(p) {
  requireAdmin_(p);
  const c = campaigns_().filter(function (x) { return x.id === String(p.id); })[0];
  if (!c) throw new Error('ไม่พบแคมเปญ');
  settingsTab_().getRange('B2').setValue(c.id);
  return { ok: true };
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
    sh.getRange(2, 1, 1, C.JSON).setValues([['c1', 'แคมเปญตัวอย่าง', '{{name}} แชร์สิ่งนี้ให้คุณ 👀', true, '✅ พร้อมใช้',
      campaignLink_('c1'), 0, 0, now, now, 'ตัวอย่าง — แก้รูป ข้อความ ลิงก์ ได้ในหน้าแอดมิน', P + JSON.stringify(sampleFlex_())]]);
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
    try { sweepCampaigns_(); } catch (e) { console.error(e); }
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

// ---------- แคมเปญจากชีต: วาง JSON จาก Flex Simulator ในแท็บ campaigns → ระบบตรวจ/เติมให้เอง ----------
// ติดตั้งครั้งเดียว: เลือก setupCampaignTools > เรียกใช้ (ย้ายคอลัมน์เดิม + สร้างแท็บ "ตั้งค่า" + ตัวตรวจอัตโนมัติ)

function settingsTab_() {
  const ss = ss_();
  let sh = ss.getSheetByName(T_SETTINGS);
  if (sh) return sh;
  sh = ss.insertSheet(T_SETTINGS, 0);
  const camp = "'" + T_CAMPAIGNS + "'";
  sh.getRange('A1:B1').setValues([['ตั้งค่า', 'ค่า']]).setFontWeight('bold').setBackground('#e8f5e9');
  sh.getRange('A2:A5').setValues([['⭐ แคมเปญหลัก (ลิงก์เปล่าจะโชว์แคมเปญนี้) — เลือก id'], ['ชื่อแคมเปญหลัก'], ['สถานะ'], ['ลิงก์ส่งให้ลูกค้า']]);
  sh.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(T_CAMPAIGNS).getRange('A2:A'), true).setAllowInvalid(false).build())
    .setBackground('#fff8e1').setFontWeight('bold');
  sh.getRange('B3').setFormula('=IFERROR(VLOOKUP(B2,' + camp + '!$A:$B,2,FALSE),"⚠️ ไม่พบ id นี้")');
  sh.getRange('B4').setFormula('=IFERROR(VLOOKUP(B2,' + camp + '!$A:$E,5,FALSE),"")');
  sh.getRange('B5').setValue('https://liff.line.me/' + LIFF_ID);
  sh.getRange('A7').setValue('วิธีสร้างแคมเปญ').setFontWeight('bold');
  sh.getRange('A8:A15').setValues([
    ['1) ออกแบบการ์ดใน developers.line.biz/flex-simulator > กด View as JSON > Copy'],
    ['2) แท็บ campaigns: แถวว่าง > ใส่ชื่อในช่อง B (ไม่ใส่ก็ได้) > ดับเบิลคลิกช่อง L > Ctrl+V > Enter'],
    ['   ⚠️ ต้องดับเบิลคลิกก่อนวาง (ถ้าเผลอวางแตกหลายแถว ระบบจะพยายามรวมให้เอง)'],
    ['3) รอ 1–2 วินาที: ระบบเติม id, ติ๊กเปิดใช้, สถานะ ✅/❌ และลิงก์แคมเปญ ให้เอง'],
    ['4) ลิงก์เปล่าจะโชว์แคมเปญไหน → เลือก id ในช่อง B2 ด้านบน (ลิงก์ของแต่ละแคมเปญอยู่คอลัมน์ F)'],
    ['5) ตัวแปร: {{name}} ชื่อคนแชร์ · {{picture}} รูปคนแชร์ (ช่อง url ของรูป) · {{shareUrl}} ลิงก์แชร์ต่อ (ใส่ในปุ่ม ไม่ใส่ระบบเติมปุ่มให้)'],
    ['   {{members}} คนร่วมทั้งหมด · {{invited}} คนที่ผู้แชร์ชวนได้ · {{campaign}} ชื่อแคมเปญ · {{date}} วันที่'],
    ['6) ปิดแคมเปญ: เอาติ๊ก "เปิดใช้" ออก → คนที่กดการ์ดเก่าจะถูกพาไปแคมเปญหลักแทน (สายแชร์ไม่ขาด)'],
  ]);
  sh.setColumnWidth(1, 430);
  sh.setColumnWidth(2, 360);
  sh.setFrozenRows(1);
  return sh;
}

// ย้ายแคมเปญจากโครงสร้างเดิม (E=คนเข้าร่วม, J=JSON) → โครงสร้างใหม่ (E=สถานะ, F=ลิงก์, L=JSON)
function migrateCampaigns_() {
  const sh = tab_(T_CAMPAIGNS);
  if (String(sh.getRange(1, 5).getValue()) !== 'คนเข้าร่วม') return 0;
  const last = sh.getLastRow(), width = sh.getLastColumn();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  const out = rows.filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    const chunks = [];
    for (let c = 9; c < r.length; c++) { if (r[c] === '' || r[c] == null) break; chunks.push(String(r[c])); }
    return [txt_(r[0]), txt_(r[1]), txt_(r[2]), r[3], '', '', r[4], r[5], r[6], r[7], txt_(r[8])].concat(chunks);
  });
  const w = out.reduce(function (m, r) { return Math.max(m, r.length); }, C.JSON);
  out.forEach(function (r) { while (r.length < w) r.push(''); });
  sh.clear();
  sh.getRange(1, 1, 1, C_HEAD.length).setValues([C_HEAD]);
  if (out.length) sh.getRange(2, 1, out.length, w).setValues(out);
  return out.length;
}

function tidyCampaignRow_(sh, row) {
  sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), C.JSON))
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP).setVerticalAlignment('middle');
  sh.setRowHeightsForced(row, 1, 30);
}

// ตรวจ Flex JSON → { ok, msg, json(ย่อแล้ว) }
function validateFlex_(json) {
  let obj;
  try { obj = JSON.parse(String(json || '').trim()); }
  catch (e) { return { ok: false, msg: '❌ JSON ผิดรูปแบบ (' + String(e.message).slice(0, 90) + ') — คัดลอกจาก View as JSON ใหม่ให้ครบ' }; }
  if (obj && obj.type === 'flex' && obj.contents) obj = obj.contents;
  if (!obj || (obj.type !== 'bubble' && obj.type !== 'carousel')) {
    return { ok: false, msg: '❌ ต้องเป็น bubble หรือ carousel (คัดลอกจากปุ่ม View as JSON ใน Flex Simulator)' };
  }
  if (obj.type === 'carousel' && (!Array.isArray(obj.contents) || obj.contents.length < 1 || obj.contents.length > 12)) {
    return { ok: false, msg: '❌ carousel ต้องมี 1–12 การ์ด' };
  }
  const min = JSON.stringify(obj);
  if (/"url"\s*:\s*"http:\/\//.test(min)) return { ok: false, msg: '❌ ลิงก์รูปต้องขึ้นต้นด้วย https://' };
  try {
    render_({ id: 'test', name: 'test', altText: '', joined: 0, json: min },
      { name: 'ทดสอบ', picture: DEFAULT_AVATAR, ref: 'test', invited: 0, shares: 0 });
  } catch (e) { return { ok: false, msg: '❌ ใส่ตัวแปร {{...}} แล้ว JSON พัง: ' + e.message }; }
  const kb = Utilities.newBlob(min).getBytes().length / 1024;
  if (kb > (obj.type === 'bubble' ? 30 : 50)) {
    return { ok: true, json: min, msg: '⚠️ ใหญ่ ' + kb.toFixed(1) + ' KB — LINE อาจไม่รับ (bubble ≤ 30 KB, carousel ≤ 50 KB)' };
  }
  const notes = [];
  if (obj.type === 'carousel') notes.push(obj.contents.length + ' การ์ด');
  if (min.indexOf('{{shareUrl}}') < 0) notes.push('ไม่มี {{shareUrl}} → ระบบเติมปุ่มแชร์ให้');
  return { ok: true, json: min, msg: '✅ พร้อมใช้' + (notes.length ? ' · ' + notes.join(' · ') : '') };
}

// ตรวจ/เติมแถวแคมเปญ 1 แถว: id, ชื่อ, ติ๊กเปิดใช้, วันที่, สถานะ, ลิงก์
function checkCampaignRow_(sh, row) {
  const width = Math.max(sh.getLastColumn(), C.JSON);
  const v = sh.getRange(row, 1, 1, width).getValues()[0];
  let json = '';
  for (let c = C.JSON - 1; c < v.length; c++) { if (v[c] === '' || v[c] == null) break; json += un_(v[c]); }
  let id = String(v[C.ID - 1]).trim();
  const name = String(v[C.NAME - 1]).trim();
  if (!id && !name && !json) { sh.getRange(row, C.STATUS, 1, 2).clearContent(); return; }
  const ids = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (!id) {
    do { id = 'c' + rand_(5); } while (ids.indexOf(id) > -1);
    sh.getRange(row, C.ID).setValue(id);
  }
  let status = '';
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(id)) status = '❌ id ใช้ได้เฉพาะ a-z A-Z 0-9 _ - (ไม่เกิน 30 ตัว)';
  else if (ids.filter(function (x) { return x === id; }).length > 1) status = '❌ id ซ้ำกับแถวอื่น';
  if (!status) status = json ? validateFlex_(json).msg : '⏳ ยังไม่มี Flex JSON — ดับเบิลคลิกช่อง L แล้ววาง';
  const now = new Date();
  if (!name) sh.getRange(row, C.NAME).setValue(id);
  if (v[C.ACTIVE - 1] === '' && json) sh.getRange(row, C.ACTIVE).setValue(true);
  if (json || v[C.ACTIVE - 1] !== '') {
    sh.getRange(row, C.ACTIVE).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
  if (v[C.JOINED - 1] === '') sh.getRange(row, C.JOINED, 1, 2).setValues([[0, 0]]);
  if (!v[C.CREATED - 1]) sh.getRange(row, C.CREATED).setValue(now);
  sh.getRange(row, C.UPDATED).setValue(now);
  sh.getRange(row, C.STATUS, 1, 2).setValues([[status, campaignLink_(id)]]);
  sh.getRange(row, C.STATUS).setNote(campaignSig_(json, id));
  tidyCampaignRow_(sh, row);
}

// ลายเซ็นของแถว (id + JSON) เก็บในโน้ตของช่องสถานะ — ใช้ดูว่าแถวไหนเปลี่ยนแต่ยังไม่ได้ตรวจ
function campaignSig_(json, id) {
  return 'sig:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(id) + '|' + json)).slice(0, 16);
}

// ตัวกวาดสำรองทุก 1 นาที (เรียกจาก processImages): ตรวจแถวที่ตัวตรวจอัตโนมัติพลาด (เช่น แก้หลายช่องเร็วๆ)
function sweepCampaigns_() {
  const sh = ss_().getSheetByName(T_CAMPAIGNS);
  if (!sh || sh.getLastRow() < 2 || String(sh.getRange(1, C.STATUS).getValue()).indexOf('สถานะ') !== 0) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const last = sh.getLastRow(), width = Math.max(sh.getLastColumn(), C.JSON);
    const vals = sh.getRange(2, 1, last - 1, width).getValues();
    const notes = sh.getRange(2, C.STATUS, last - 1, 1).getNotes();
    vals.forEach(function (v, i) {
      let json = '';
      for (let c = C.JSON - 1; c < v.length; c++) { if (v[c] === '' || v[c] == null) break; json += un_(v[c]); }
      const id = String(v[C.ID - 1]).trim();
      if (!id && !String(v[C.NAME - 1]).trim() && !json) return;
      if (notes[i][0] !== campaignSig_(json, id)) checkCampaignRow_(sh, i + 2);
    });
  } finally {
    lock.releaseLock();
  }
}

// เผลอวาง JSON หลายบรรทัดแบบไม่ดับเบิลคลิก → ชีตแตกเป็นหลายแถว → รวมกลับเป็นช่องเดียวให้
function fixSplitPaste_(sh, range) {
  const r0 = range.getRow(), n = range.getNumRows(), col = range.getColumn();
  if (r0 < 2 || n < 2 || range.getNumColumns() !== 1) return false;
  const lines = range.getValues().map(function (v) { return String(v[0]); });
  let obj = null;
  try { obj = JSON.parse(lines.join('\n')); } catch (e) {}
  if (!obj) {
    if (lines[0].trim() === '{') {
      sh.getRange(r0, C.STATUS).setValue('❌ JSON แตกลงหลายแถว — กด Ctrl+Z แล้วดับเบิลคลิกช่อง L ก่อนวาง');
      return true;
    }
    return false;
  }
  const others = sh.getRange(r0 + 1, 1, n - 1, C.NOTE).getValues();
  const clean = others.every(function (r) {
    return r.every(function (x, i) { return i === col - 1 || x === '' || x === false; });
  });
  if (!clean) {
    sh.getRange(r0, C.STATUS).setValue('❌ วาง JSON ทับแถวแคมเปญอื่น — กด Ctrl+Z แล้วดับเบิลคลิกช่อง L ก่อนวาง');
    return true;
  }
  range.clearContent();
  writeJson_(sh, r0, JSON.stringify(obj));
  sh.deleteRows(r0 + 1, n - 1);
  checkCampaignRow_(sh, r0);
  return true;
}

// ตัวตรวจอัตโนมัติ (ตัวตั้งเวลาแบบ "เมื่อแก้ไขชีต")
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== T_CAMPAIGNS) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    if (fixSplitPaste_(sh, e.range)) return;
    const r0 = Math.max(2, e.range.getRow()), r1 = Math.min(e.range.getLastRow(), sh.getLastRow());
    for (let r = r0; r <= r1 && r < r0 + 50; r++) checkCampaignRow_(sh, r);
  } catch (err) {
    console.error(err);
  } finally {
    lock.releaseLock();
  }
}

function setupCampaignTools() {
  const moved = withLock_(migrateCampaigns_);
  const sh = tab_(T_CAMPAIGNS);
  sh.getRange(1, 1, 1, C_HEAD.length).setValues([C_HEAD]).setFontWeight('bold').setBackground('#e8f5e9');
  sh.setFrozenRows(1);
  // แถวข้อมูลจริง (ดูจาก id / ชื่อ / JSON) — ช่องติ๊กใส่เฉพาะแถวที่มีข้อมูล ไม่งั้นชีตนับว่ามีข้อมูลถึงแถวสุดท้าย
  const max = sh.getMaxRows();
  const cols = [C.ID, C.NAME, C.JSON].map(function (c) { return sh.getRange(1, c, max, 1).getValues(); });
  let lastData = 1;
  for (let r = max; r >= 2 && lastData === 1; r--) {
    if (cols.some(function (v) { return String(v[r - 1][0]).trim(); })) lastData = r;
  }
  if (max > lastData) sh.getRange(lastData + 1, C.ACTIVE, max - lastData, 1).clearDataValidations().clearContent();
  sh.getRange(2, C.JOINED, max - 1, 2).setNumberFormat('0');
  sh.getRange(2, C.CREATED, max - 1, 2).setNumberFormat('d/m/yyyy HH:mm');
  [80, 170, 220, 64, 320, 340, 80, 70, 110, 110, 160, 420].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  const st = settingsTab_();
  for (let r = 2; r <= lastData; r++) checkCampaignRow_(sh, r);
  if (!mainCampaignId_()) {
    const first = campaigns_().filter(usable_)[0];
    if (first) st.getRange('B2').setValue(first.id);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(SHEET_ID).onEdit().create();
  Logger.log('เสร็จ — ย้ายแคมเปญเดิม ' + moved + ' แถว · แคมเปญหลัก: ' + mainCampaignId_() + ' · ตัวตรวจอัตโนมัติพร้อม');
}
