/****************************************************
 * PMS eSign — Quản lý tài liệu ký số
 * Phiên bản: 2026-04-22 (maDA-tenGT_signed, 1 thư mục DA, email+Telegram thông báo)
 ****************************************************/

const CFG = {
  SHEET_ID      : '1mrm0_z0hFFlKAKu3ST--rTu5rNIp6HvkU85g0u1T2Fg',
  SHEET_TL      : 'TaiLieuKySo',
  SHEET_USERS   : 'NguoiDung',   // B: email, D: role
  SHEET_DA      : 'DuAn',        // A: maDA | B: tenDA
  SHEET_GT      : 'GoiThau',     // A: maDA | B: maGT | C: tenGT | D: tenNhaThau | E: emailNhaThau
  DRIVE_FOLDER_ID : '17r-68vDCnGN6RxNu-TnHbe80BfbwVUYq'
};

const TELEGRAM = {
  TOKEN     : '6645945101:AAE0dgJup-bJcdXr5WI30naV5kVpt0v3n9M',
  CHAT_ID   : '-1002010998673',
  THREAD_ID : 5
};

/* ====================== HTML boot ====================== */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('PMS eSign — Upload Signed PDF')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name){ return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/**
 * doPost(e) - API endpoint cho Vercel Proxy
 * Nhận POST từ Vercel: payload=<json_encoded>
 */
function doPost(e) {
  let res;
  try {
    // Đọc payload: hỗ trợ cả form-encoded (payload=...) và JSON body
    let rawJson = '';
    const ct = (e.postData && e.postData.type) ? e.postData.type.toLowerCase() : '';

    if (ct.indexOf('application/x-www-form-urlencoded') >= 0) {
      rawJson = decodeURIComponent((e.parameter && e.parameter.payload) || '{}');
    } else {
      rawJson = (e.postData && e.postData.contents) || '{}';
    }

    const params = JSON.parse(rawJson);
    const action = params.action;
    const args   = params.args || [];

    const allowed = ['login', 'listProjects', 'listPackages', 'saveSignedOnly', 'changePin'];
    if (allowed.indexOf(action) === -1) throw new Error('Hành động không hợp lệ: ' + action);

    const result = this[action].apply(null, args);
    res = { ok: true, data: result };

  } catch (err) {
    res = { ok: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ====================== Spreadsheet & Drive ====================== */
function getSpreadsheet_(){
  try { return SpreadsheetApp.openById(CFG.SHEET_ID); }
  catch(e){ throw new Error('Không thể mở Spreadsheet. Chi tiết: '+e); }
}
function ensureFolder_(parent, name){
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function getRoot_(){ return DriveApp.getFolderById(CFG.DRIVE_FOLDER_ID); }

// Chuyển tiếng Việt có dấu → không dấu, viết liền
function removeDiacritics_(str){
  return String(str||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g,'d').replace(/\u0110/g,'D')
    .replace(/[^a-zA-Z0-9]/g,'');
}

// Trả về thư mục dự án: root / "maDA-tenDA"  (không tạo sub-folder)
function getOrCreateProjectFolder(maDA, tenDA){
  const folderName = String(maDA||'').trim() + '-' + removeDiacritics_(tenDA);
  return ensureFolder_(getRoot_(), folderName);
}

// Tránh trùng tên: nếu "abc_signed.pdf" đã có → dùng "abc_signed(1).pdf"
function uniqueFileName_(folder, baseName){
  const dotIdx = baseName.lastIndexOf('.');
  const ext  = dotIdx >= 0 ? baseName.slice(dotIdx)  : '';
  const stem = dotIdx >= 0 ? baseName.slice(0, dotIdx) : baseName;
  let candidate = baseName, counter = 1;
  while (folder.getFilesByName(candidate).hasNext()) {
    candidate = stem + '(' + counter + ')' + ext;
    counter++;
  }
  return candidate;
}

/* ====================== Header helpers ====================== */
function _rmDiacritics_(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function _normHeader_(s){ return _rmDiacritics_(s).toLowerCase().replace(/[^a-z0-9]+/g,''); }
function _findCol_(hdr, aliases){
  const map = Object.fromEntries(hdr.map((h,i)=>[_normHeader_(h), i]));
  for(const a of aliases){ const k=_normHeader_(a); if(map[k]!==undefined) return map[k]; }
  return -1;
}
function _emailsOfCell_(v){
  return String(v||'').split(/[;,]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
}
function _roleIs_(role, target){ return _normHeader_(role) === _normHeader_(target); }

/* ====================== Auth ====================== */
function getUserByEmail_(email){
  const sh=getSpreadsheet_().getSheetByName(CFG.SHEET_USERS);
  const data=sh.getDataRange().getValues(); if(!data.length) return null;
  const hdr=data[0]||[];
  const c_email = _findCol_(hdr, ['email','mail','tai khoan','account']);
  const c_pin   = _findCol_(hdr, ['pin','ma pin','passcode']);
  const c_role  = _findCol_(hdr, ['role','vai tro','quyen','nhom']);
  const c_nt    = _findCol_(hdr, ['nha thau','ten nha thau','contractor','nha_thau']);
  for(let r=1;r<data.length;r++){
    const em = String(data[r][c_email]||'').toLowerCase();
    if(em === String(email||'').toLowerCase()){
      return {
        email: String(email),
        pin  : String(c_pin>=0 ? (data[r][c_pin]||'') : ''),
        role : c_role>=0 ? (data[r][c_role]||'') : '',
        nhaThau: c_nt>=0 ? (data[r][c_nt]||'') : ''
      };
    }
  }
  return null;
}
function login(email,pin){
  const u=getUserByEmail_(email);
  if(!u) throw new Error('Email chưa được cấp quyền trong NguoiDung.');
  if(String(u.pin||'') !== String(pin||'')) throw new Error('PIN không đúng.');
  const token=Utilities.getUuid();
  CacheService.getUserCache().put('t:'+token, JSON.stringify(u), 3600);
  return { token, profile:{ email:u.email, role:u.role, nhaThau:u.nhaThau } };
}
function assertAuth(token){
  const raw=CacheService.getUserCache().get('t:'+token);
  if(!raw) throw new Error('Phiên đăng nhập hết hạn');
  return JSON.parse(raw);
}

/* ====================== Danh mục Dự án ====================== */
function listProjects(token){
  const u = assertAuth(token);
  const ss = getSpreadsheet_();
  const shDA = ss.getSheetByName(CFG.SHEET_DA);
  const shGT = ss.getSheetByName(CFG.SHEET_GT);
  if(!shDA || !shGT) throw new Error('Thiếu sheet DuAn hoặc GoiThau');
  const dDA = shDA.getDataRange().getValues(); if(!dDA.length) return [];
  const dGT = shGT.getDataRange().getValues(); if(!dGT.length) return [];
  const hDA = dDA.shift(), hGT = dGT.shift();
  const c_maDA_DA  = _findCol_(hDA, ['maDA','maduan','projectid','ma']);
  const c_tenDA_DA = _findCol_(hDA, ['tenDA','tenduan','projectname','ten']);
  if(c_maDA_DA<0 || c_tenDA_DA<0) throw new Error('Sheet DuAn thiếu maDA/tenDA.');
  const c_maDA_GT  = _findCol_(hGT, ['maDA','maduan','projectid','ma']);
  const c_email_GT = _findCol_(hGT, ['emailNhaThau','email nha thau','contractoremail','email']);
  if(c_maDA_GT<0) throw new Error('Sheet GoiThau thiếu maDA.');
  const isAdmin = _roleIs_(u.role,'Admin');
  const isUser  = _roleIs_(u.role,'User');
  const loginEmail = String(u.email||'').toLowerCase();
  const allowed = new Set();
  if(isAdmin){
    for(const r of dGT){ allowed.add(String(r[c_maDA_GT]||'').trim()); }
  } else if(isUser){
    if(c_email_GT<0) return [];
    for(const r of dGT){
      const emails=_emailsOfCell_(r[c_email_GT]);
      if(emails.includes(loginEmail)) allowed.add(String(r[c_maDA_GT]||'').trim());
    }
  } else { return []; }
  return dDA
    .filter(r => allowed.has(String(r[c_maDA_DA]||'').trim()))
    .map(r => ({ id:String(r[c_maDA_DA]||'').trim(), name:String(r[c_tenDA_DA]||'').trim() }));
}

/* ====================== Danh mục Gói thầu ====================== */
function listPackages(token, maDA){
  const u = assertAuth(token);
  const sh = getSpreadsheet_().getSheetByName(CFG.SHEET_GT);
  if(!sh) throw new Error('Không tìm thấy sheet '+CFG.SHEET_GT);
  const data = sh.getDataRange().getValues(); if(!data.length) return [];
  const hdr  = data.shift();
  const c_maDA = _findCol_(hdr, ['maDA','maduan','projectid','ma']);
  const c_maGT = _findCol_(hdr, ['maGT','magoithau','packageid','magoi','ma']);
  const c_tenGT= _findCol_(hdr, ['tenGT','tengoithau','packagename','tengoi','ten']);
  const c_email= _findCol_(hdr, ['emailNhaThau','email nha thau','contractoremail','email']);
  if(c_maDA<0 || c_maGT<0 || c_tenGT<0) throw new Error('Sheet GoiThau thiếu maDA/maGT/tenGT.');
  const key = String(maDA||'').trim();
  const isAdmin = _roleIs_(u.role,'Admin');
  const isUser  = _roleIs_(u.role,'User');
  const loginEmail = String(u.email||'').toLowerCase();
  return data
    .filter(r => String(r[c_maDA]||'').trim() === key)
    .filter(r => {
      if(isAdmin) return true;
      if(isUser){
        if(c_email<0) return false;
        return _emailsOfCell_(r[c_email]).includes(loginEmail);
      }
      return false;
    })
    .map(r => ({ id:String(r[c_maGT]||'').trim(), name:String(r[c_tenGT]||'').trim() }));
}

/* ====================== Tra tên DA/GT ====================== */
function getProjectAndPackageNames_(maDA, maGT){
  const ss=getSpreadsheet_();
  let tenDA=''; {
    const sh=ss.getSheetByName(CFG.SHEET_DA);
    const data=sh.getDataRange().getValues(); const hdr=data.shift()||[];
    const ca=_findCol_(hdr,['maDA','maduan','projectid','ma']);
    const cb=_findCol_(hdr,['tenDA','tenduan','projectname','ten']);
    for(const r of data){ if(String(r[ca]||'').trim()===String(maDA||'').trim()){ tenDA=String(r[cb]||'').trim(); break; } }
  }
  let tenGT=''; {
    const sh=ss.getSheetByName(CFG.SHEET_GT);
    const data=sh.getDataRange().getValues(); const hdr=data.shift()||[];
    const ca=_findCol_(hdr,['maDA','maduan','projectid','ma']);
    const cb=_findCol_(hdr,['maGT','magoithau','packageid','magoi','ma']);
    const cc=_findCol_(hdr,['tenGT','tengoithau','packagename','tengoi','ten']);
    for(const r of data){
      if(String(r[ca]||'').trim()===String(maDA||'').trim() &&
         String(r[cb]||'').trim()===String(maGT||'').trim()){
        tenGT=String(r[cc]||'').trim(); break;
      }
    }
  }
  return {tenDA, tenGT};
}

/* ====================== Kiểm tra PDF đã ký số ====================== */
function verifyPdfHasSignature_(blob){
  const mime=(blob.getContentType()||'').toLowerCase();
  if(mime!=='application/pdf' && mime!=='application/octet-stream')
    throw new Error('Chỉ tiếp nhận tệp PDF đã ký số.');
  const bytes=blob.getBytes(); const size=bytes.length; const cap=Math.min(size,8*1024*1024);
  let s=''; for(let i=0;i<cap;i++) s+=String.fromCharCode(bytes[i]);
  if(!s.startsWith('%PDF')) throw new Error('Tệp không phải PDF hợp lệ (thiếu header %PDF).');
  const hasTypeSig  = /\/Type\s*\/Sig\b/.test(s);
  const hasContents = /\/Contents\s*</.test(s);
  const hasByteRange= /\/ByteRange\s*\[([^\]]+)\]/.test(s);
  if(!hasTypeSig)  throw new Error('PDF chưa có trường chữ ký (/Type /Sig).');
  if(!hasContents) throw new Error('Không tìm thấy nội dung chữ ký (/Contents).');
  if(!hasByteRange)throw new Error('Không tìm thấy ByteRange hợp lệ trong PDF.');
  const m=/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s);
  if(m){
    const a=+m[1],b=+m[2],c=+m[3],d=+m[4];
    if([a,b,c,d].some(n=>!isFinite(n)||n<0)) throw new Error('ByteRange không hợp lệ (âm/NaN).');
    if(a+b>size||c+d>size) throw new Error('ByteRange vượt quá kích thước tệp.');
    const diff=Math.abs(a+b+c+d-size);
    if(diff>1024*1024) Logger.log('⚠️ ByteRange chênh '+diff+' bytes. Cho phép.');
  }
  return true;
}

/* ====================== Lưu file ký số ====================== */
function saveSignedOnly(token, maDA, maGT, file, signedByCDT){
  const u = assertAuth(token);
  if(!file || !file.dataBase64) throw new Error('Thiếu dữ liệu tệp');

  const blob = Utilities.newBlob(
    Utilities.base64Decode(file.dataBase64), 'application/pdf', file.name||'upload.pdf'
  );
  verifyPdfHasSignature_(blob);

  // Idempotency 15s
  const md5 = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
  );
  const idemKey = ['idem',(u.email||'').toLowerCase(),String(maDA||''),String(maGT||''),md5].join('|');
  const cache = CacheService.getScriptCache();
  if(cache.get(idemKey)) return { ok:true, dedup:true, message:'Bỏ qua bản sao trong cửa sổ 15s.' };
  cache.put(idemKey,'1',15);

  const {tenDA, tenGT} = getProjectAndPackageNames_(maDA, maGT);

  // Tên file: maDA-tenGT_signed.pdf
  const safeTenGT = String(tenGT||'').replace(/[\\\/:*?"<>|]+/g,'_').trim();
  const suffix    = signedByCDT ? '_signed_signed' : '_signed';
  const finalName = String(maDA||'').trim() + '-' + safeTenGT + suffix + '.pdf';

  // Lưu vào 1 thư mục dự án (không tạo sub-folder)
  const projectFolder = getOrCreateProjectFolder(maDA, tenDA);
  const savedName     = uniqueFileName_(projectFolder, finalName);
  const gFile         = projectFolder.createFile(blob).setName(savedName).setDescription('Signed PDF');
  const fileUrl       = gFile.getUrl();

  // Ghi vào Sheet
  getSpreadsheet_().getSheetByName(CFG.SHEET_TL)
    .appendRow([new Date(), maDA, maGT, savedName, fileUrl, u.email||'']);

  // Telegram
  sendTelegram_(
    '\uD83D\uDCC2 <b><a href="' + fileUrl + '">Tài liệu mới tải lên</a></b>\n'
    + '\uD83D\uDCCC Dự án: ' + maDA + '-' + (tenDA||'') + '\n'
    + '\uD83D\uDCCC Gói thầu: ' + (tenGT||'') + '\n'
    + '\uD83D\uDC64 Người nộp: ' + (u.email||'') + '\n'
    + '\uD83D\uDCCE File: <a href="' + fileUrl + '">' + savedName + '</a>'
  );

  // Email thông báo
  let emailStatus = '';
  try {
    if (!u.email) {
      emailStatus = 'Không thể gửi email thông báo, vui lòng kiểm tra cài đặt email nhận';
    } else {
      const now = new Date().toLocaleString('vi-VN', {
        timeZone:'Asia/Ho_Chi_Minh', day:'2-digit', month:'2-digit',
        year:'numeric', hour:'2-digit', minute:'2-digit'
      });
      const htmlBody =
        // Outer wrapper
        '<div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">'
        + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">'
        + '<tr><td align="center">'
        + '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;'
        + 'overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.10);max-width:600px;">'

        // ── HEADER ──
        + '<tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 60%,#0ea5e9 100%);'
        + 'padding:32px 36px 24px;">'
        + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        + '<td style="color:#fff;">'
        + '<div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.85;margin-bottom:6px;">PMS eSign</div>'
        + '<div style="font-size:22px;font-weight:700;line-height:1.3;">📂 Tài liệu mới tải lên</div>'
        + '<div style="font-size:13px;opacity:.8;margin-top:6px;">Thông báo tự động từ hệ thống</div>'
        + '</td>'
        + '<td align="right" style="font-size:48px;opacity:.25;">📄</td>'
        + '</tr></table>'
        + '</td></tr>'

        // ── BODY ──
        + '<tr><td style="padding:28px 36px 8px;">'
        + '<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">'
        + 'Xin chào, <b>' + (u.email||'') + '</b>.<br>'
        + 'Tài liệu ký số của bạn đã được <b style="color:#16a34a;">tải lên thành công</b> vào hệ thống.</p>'
        + '</td></tr>'

        // ── INFO TABLE ──
        + '<tr><td style="padding:0 36px 24px;">'
        + '<table width="100%" cellpadding="0" cellspacing="0" '
        + 'style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;">'

        + '<tr>'
        + '<td style="padding:11px 16px;background:#f8fafc;font-weight:700;color:#6b7280;'
        + 'width:130px;border-bottom:1px solid #e5e7eb;">Dự án</td>'
        + '<td style="padding:11px 16px;color:#111827;border-bottom:1px solid #e5e7eb;">'
        + maDA + ' — ' + (tenDA||'') + '</td></tr>'

        + '<tr>'
        + '<td style="padding:11px 16px;background:#f8fafc;font-weight:700;color:#6b7280;'
        + 'border-bottom:1px solid #e5e7eb;">Gói thầu</td>'
        + '<td style="padding:11px 16px;color:#111827;border-bottom:1px solid #e5e7eb;">'
        + (tenGT||'') + '</td></tr>'

        + '<tr>'
        + '<td style="padding:11px 16px;background:#f8fafc;font-weight:700;color:#6b7280;'
        + 'border-bottom:1px solid #e5e7eb;">Người nộp</td>'
        + '<td style="padding:11px 16px;color:#111827;border-bottom:1px solid #e5e7eb;">'
        + (u.email||'') + '</td></tr>'

        + '<tr>'
        + '<td style="padding:11px 16px;background:#f8fafc;font-weight:700;color:#6b7280;'
        + 'border-bottom:1px solid #e5e7eb;">Tên file</td>'
        + '<td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;">'
        + '<a href="' + fileUrl + '" style="color:#2563eb;font-weight:600;text-decoration:none;">'
        + savedName + '</a></td></tr>'

        + '<tr>'
        + '<td style="padding:11px 16px;background:#f8fafc;font-weight:700;color:#6b7280;">Thời gian</td>'
        + '<td style="padding:11px 16px;color:#111827;">' + now + '</td></tr>'

        + '</table>'
        + '</td></tr>'

        // ── CTA BUTTON ──
        + '<tr><td align="center" style="padding:4px 36px 32px;">'
        + '<a href="' + fileUrl + '" '
        + 'style="display:inline-block;background:linear-gradient(135deg,#1e40af,#2563eb);'
        + 'color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;'
        + 'padding:13px 36px;border-radius:8px;letter-spacing:.3px;">'
        + '🔗 &nbsp;Xem file trên Google Drive</a>'
        + '</td></tr>'

        // ── FOOTER ──
        + '<tr><td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 36px;'
        + 'text-align:center;color:#9ca3af;font-size:12px;">'
        + 'Email này được gửi tự động bởi <b>PMS eSign</b>. Vui lòng không trả lời email này.'
        + '</td></tr>'

        + '</table></td></tr></table></div>';

      MailApp.sendEmail({
        to      : u.email,
        subject : '[PMS eSign] ✅ Tải lên thành công: ' + savedName,
        htmlBody: htmlBody
      });
      emailStatus = 'Đã gửi email thông báo cho người dùng';
    }
  } catch(e) {
    emailStatus = 'Không thể gửi email thông báo, vui lòng kiểm tra cài đặt email nhận';
    Logger.log('Email error: ' + e.message);
  }

  return { ok:true, url:fileUrl, name:savedName, id:gFile.getId(), emailStatus:emailStatus };
}

/* ====================== Đổi PIN ====================== */
function changePin(token, oldPin, newPin){
  const u=assertAuth(token);
  const sh=getSpreadsheet_().getSheetByName(CFG.SHEET_USERS);
  const data=sh.getDataRange().getValues(); const hdr=data[0]||[];
  const c_email=_findCol_(hdr,['email','mail','tai khoan','account']);
  const c_pin  =_findCol_(hdr,['pin','ma pin','passcode']);
  if(c_email<0||c_pin<0) throw new Error('Sheet NguoiDung thiếu cột Email/PIN');
  let row=-1, cur='';
  for(let r=1;r<data.length;r++){
    if(String(data[r][c_email]||'').toLowerCase()===String(u.email).toLowerCase()){
      row=r+1; cur=String(data[r][c_pin]||''); break;
    }
  }
  if(row<0) throw new Error('Không tìm thấy tài khoản');
  if(String(oldPin||'')!==cur) throw new Error('PIN hiện tại không đúng');
  if(String(newPin||'').length<4) throw new Error('PIN mới tối thiểu 4 ký tự');
  sh.getRange(row,c_pin+1).setValue(String(newPin||''));
  u.pin=String(newPin||'');
  CacheService.getUserCache().put('t:'+token, JSON.stringify(u), 3600);
  return { ok:true };
}

/* ====================== Telegram ====================== */
function sendTelegram_(msg){
  try{
    if(!TELEGRAM.TOKEN||!TELEGRAM.CHAT_ID) return;
    const payload = {
      chat_id: TELEGRAM.CHAT_ID,
      text: msg,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if(Number(TELEGRAM.THREAD_ID)>0) payload.message_thread_id=Number(TELEGRAM.THREAD_ID);
    const resp=UrlFetchApp.fetch('https://api.telegram.org/bot'+TELEGRAM.TOKEN+'/sendMessage',{
      method:'post', contentType:'application/json',
      payload:JSON.stringify(payload), muteHttpExceptions:true
    });
    Logger.log('TG resp: '+resp.getContentText());
  }catch(e){ Logger.log('Telegram error: '+e); }
}

/* ====================== TEST EMAIL (chạy trong GAS Editor để cấp quyền) ====================== */
// Cách dùng: Dropdown chọn "testEmail" → nhấn ▶ Run → Allow permission → kiểm tra Gmail
function testEmail(){
  const to = Session.getActiveUser().getEmail();
  Logger.log('Gửi test đến: '+to);
  try{
    MailApp.sendEmail({
      to,
      subject:'[PMS eSign] ✅ Test email '+new Date().toLocaleTimeString('vi-VN'),
      htmlBody:'<div style="font-family:Arial;padding:20px;">'
        +'<h2 style="color:#2563eb;">✅ MailApp hoạt động bình thường</h2>'
        +'<p>Thời gian: <b>'+new Date().toLocaleString('vi-VN')+'</b></p>'
        +'<p>Email thông báo sau khi nộp hồ sơ sẽ hoạt động bình thường.</p>'
        +'</div>'
    });
    Logger.log('✅ Gửi thành công đến: '+to);
  }catch(e){
    Logger.log('❌ Lỗi: '+e.message);
    throw e;
  }
}
