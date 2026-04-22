'use client'
import { useEffect } from 'react'

export default function Page() {
  useEffect(() => {
    // Inject the JS logic from js.html
    const script = document.createElement('script')
    script.innerHTML = `
      /* ============================ PMS eSign — Frontend JS (Vercel Support) ============================ */
      const MIME = { PDF: 'application/pdf' };
      const state = { token: null, profile: null };
      const GAS_URL = 'https://script.google.com/macros/s/AKfycbwsdDcAf5QhXW_2Zhbc9yvASh2qkamXgwlMvqKshUv0WrceFy1WljPRq-sbj0_ALlso6g/exec';

      const api = {
        run: (action, ...args) => {
          return new Promise((resolve, reject) => {
            fetch(GAS_URL, {
              method: 'POST',
              body: JSON.stringify({ action, args })
            })
            .then(r => r.json())
            .then(res => {
              if (res.ok) resolve(res.data);
              else reject(new Error(res.message));
            })
            .catch(reject);
          });
        }
      };

      function show(id, on) {
        const el = document.getElementById(id);
        if (el) el.style.display = on ? '' : 'none';
      }
      function setHtml(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
      }
      function setText(id, t) {
        const el = document.getElementById(id);
        if (el) el.textContent = t;
      }
      function showLoading(msg) {
        const ov = document.getElementById('loadingOverlay');
        const tx = document.getElementById('loadingText');
        if (ov) { ov.style.display = 'flex'; }
        if (tx) tx.textContent = msg || 'Đang xử lý...';
      }
      function hideLoading() {
        const ov = document.getElementById('loadingOverlay');
        if (ov) ov.style.display = 'none';
      }
      function showAlert(id, type, html) {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = 'alert alert-' + type + ' mt-2';
        el.innerHTML = html;
        el.classList.remove('d-none');
      }
      function hideAlert(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
      }

      const RX = {
        TYPE_SIG:  /\\/Type\\s*\\/Sig\\b/,
        BYTERANGE: /\\/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\]/,
        CONTENTS:  /\\/Contents\\s*<([0-9A-Fa-f\\s]+)>/m
      };
      async function sniffPdfSignatureStrict(file) {
        const SLICE = file.slice(0, Math.min(file.size, 6 * 1024 * 1024));
        const buf   = await SLICE.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        const isPdf    = s.startsWith('%PDF');
        const hasSig   = RX.TYPE_SIG.test(s);
        const brMatch  = RX.BYTERANGE.exec(s);
        const ctMatch  = RX.CONTENTS.exec(s);
        let reason = '';
        if (!isPdf)    reason = 'Tệp không phải PDF hợp lệ.';
        else if (!hasSig)   reason = 'PDF không có trường chữ ký (/Type /Sig).';
        else if (!brMatch)  reason = 'Không tìm thấy ByteRange hợp lệ.';
        else if (!ctMatch)  reason = 'Không tìm thấy Contents (dữ liệu chữ ký).';
        else if ((ctMatch[1]||'').replace(/\\s+/g,'').length < 512) reason = 'Dữ liệu chữ ký quá ngắn.';
        return { ok: isPdf && hasSig && !!brMatch && !!ctMatch && (ctMatch[1]||'').replace(/\\s+/g,'').length >= 512, reason };
      }

      const ui = {
        login() {
          const email = (document.getElementById('email')?.value || '').trim();
          const pin   = (document.getElementById('pin')?.value   || '').trim();
          setHtml('authMsg', '<span class="text-muted">Đang đăng nhập...</span>');
          showLoading('Đang đăng nhập...');
          api.run('login', email, pin)
            .then(res => {
              hideLoading();
              state.token   = res.token;
              state.profile = res.profile;
              setText('welcomeEmail', res.profile.email || '—');
              setText('welcomeRole',  res.profile.role  || '—');
              show('auth', false);
              show('app',  true);
              setHtml('authMsg', '');
              ui.loadProjects();
            })
            .catch(e => {
              hideLoading();
              setHtml('authMsg', '<span class="text-danger">' + (e?.message || String(e)) + '</span>');
            });
        },
        logout() {
          state.token = null;
          state.profile = null;
          show('auth', true);
          show('app',  false);
          hideAlert('uploadResultAlert');
          hideAlert('fileValidationAlert');
        },
        loadProjects() {
          const sel = document.getElementById('project');
          if (sel) sel.innerHTML = '<option value="">Đang tải...</option>';
          api.run('listProjects', state.token)
            .then(list => {
              const pj = document.getElementById('project');
              if (!pj) return;
              pj.innerHTML = '<option value="">-- Chọn dự án --</option>';
              (list || []).forEach(p => {
                const o = document.createElement('option');
                o.value = p.id; o.textContent = p.name || p.id;
                pj.appendChild(o);
              });
              if (list && list.length) ui.loadPackages();
            })
            .catch(() => {
              const pj = document.getElementById('project');
              if (pj) pj.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
            });
        },
        loadPackages() {
          const pid = document.getElementById('project')?.value || '';
          const sel = document.getElementById('pkg');
          if (sel) sel.innerHTML = '<option value="">Đang tải...</option>';
          if (!pid) { if (sel) sel.innerHTML = '<option value="">-- Chọn gói thầu --</option>'; return; }
          api.run('listPackages', state.token, pid)
            .then(list => {
              const box = document.getElementById('pkg');
              if (!box) return;
              box.innerHTML = '<option value="">-- Chọn gói thầu --</option>';
              (list || []).forEach(g => {
                const o = document.createElement('option');
                o.value = g.id; o.textContent = g.name || g.id;
                box.appendChild(o);
              });
            })
            .catch(() => {
              const box = document.getElementById('pkg');
              if (box) box.innerHTML = '<option value="">Lỗi tải dữ liệu</option>';
            });
        },
        async validateSelectedFile() {
          const f   = document.getElementById('signedFile')?.files?.[0];
          const btn = document.getElementById('btnSave');
          hideAlert('fileValidationAlert');
          hideAlert('uploadResultAlert');
          if (btn) btn.disabled = true;
          if (!f) return;
          const extOk  = /\\.pdf$/i.test(f.name || '');
          if (!extOk) { showAlert('fileValidationAlert', 'warning', '⚠️ Chỉ tiếp nhận tệp .pdf'); return; }
          showAlert('fileValidationAlert', 'secondary', '🔍 Đang kiểm tra chữ ký số...');
          try {
            const r = await sniffPdfSignatureStrict(f);
            if (!r.ok) { showAlert('fileValidationAlert', 'danger', '❌ Lỗi chữ ký: ' + r.reason); return; }
            showAlert('fileValidationAlert', 'success', '✅ PDF hợp lệ.');
            if (btn) btn.disabled = false;
          } catch (e) { showAlert('fileValidationAlert', 'warning', '⚠️ Lỗi kiểm tra.'); }
        },
        uploadSignedOnly() {
          const btn = document.getElementById('btnSave');
          const f   = document.getElementById('signedFile')?.files?.[0];
          const maDA = document.getElementById('project')?.value || '';
          const maGT = document.getElementById('pkg')?.value     || '';
          if (btn) {
            btn.disabled = true;
            btn.dataset._label = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang nộp...';
          }
          showLoading('Đang xử lý...');
          const rd = new FileReader();
          rd.onload = () => {
            const payload = { name: f.name, dataBase64: rd.result.split(',')[1], mimeType: f.type || 'application/pdf' };
            api.run('saveSignedOnly', state.token, maDA, maGT, payload)
              .then(res => {
                hideLoading();
                if (btn) { btn.innerHTML = btn.dataset._label; btn.disabled = false; }
                const emailOk = res.emailStatus && res.emailStatus.indexOf('Đã gửi') === 0;
                showAlert('uploadResultAlert', 'success', 
                  '<b>✅ Thành công!</b><br>📄 File: ' + res.name + '<br>Trạng thái email: ' + (emailOk ? '✅ OK' : '⚠️ Lỗi')
                  + '<br><a href="'+res.url+'" target="_blank">🔗 Xem file</a>'
                );
              })
              .catch(e => {
                hideLoading();
                if (btn) { btn.innerHTML = btn.dataset._label; btn.disabled = false; }
                showAlert('uploadResultAlert', 'danger', '❌ Lỗi: ' + e.message);
              });
          };
          rd.readAsDataURL(f);
        },
        openChangePin() {
          const m = new bootstrap.Modal(document.getElementById('pinModal'));
          m.show();
        },
        changePin() {
          const oldPin  = document.getElementById('pinOld').value;
          const newPin  = document.getElementById('pinNew').value;
          const newPin2 = document.getElementById('pinNew2').value;
          if (newPin !== newPin2) { setText('pinMsg', 'PIN nhập lại không khớp'); return; }
          api.run('changePin', state.token, oldPin, newPin)
            .then(() => {
              bootstrap.Modal.getInstance(document.getElementById('pinModal')).hide();
              showAlert('uploadResultAlert', 'info', '🔑 Đổi PIN thành công!');
            })
            .catch(e => setText('pinMsg', '❌ ' + e.message));
        }
      };

      window.ui = ui;
      document.getElementById('signedFile').addEventListener('change', ui.validateSelectedFile);
    `
    document.body.appendChild(script)
  }, [])

  return (
    <div className="container p-0" style={{ maxWidth: '800px', margin: '40px auto' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        :root { --brand-color: #0d6efd; }
        body { background-color: #f0f2f5; }
        .card-custom { border: none; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,.1); background: white; }
        #loadingOverlay { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(255,255,255,0.8); z-index: 9999; display: none; align-items: center; justify-content: center; flex-direction: column; }
      `}} />

      <div id="loadingOverlay">
        <div className="spinner-border text-primary" style={{ width: '3rem', height: '3rem' }}></div>
        <div className="mt-2 fw-bold text-primary" id="loadingText">Đang xử lý...</div>
      </div>

      <h2 className="text-primary fw-bold text-center mb-4"><i className="bi bi-shield-check"></i> PMS eSign System</h2>

      {/* Auth */}
      <div id="auth" className="card card-custom p-4">
        <h4 className="mb-3 text-center">Đăng nhập hệ thống</h4>
        <div className="row g-3">
          <div className="col-md-7">
            <label className="form-label fw-bold">Email đăng ký</label>
            <input type="email" id="email" className="form-control" placeholder="example@domain.com" />
          </div>
          <div className="col-md-5">
            <label className="form-label fw-bold">Mã PIN</label>
            <input type="password" id="pin" className="form-control" placeholder="****" />
          </div>
          <div className="col-12">
            <button className="btn btn-primary w-100 fw-bold" onClick={() => window.ui.login()}>Đăng nhập</button>
            <div id="authMsg" className="text-danger small text-center mt-2"></div>
          </div>
        </div>
      </div>

      {/* App */}
      <div id="app" className="card card-custom p-4" style={{ display: 'none' }}>
        <div className="d-flex justify-content-between align-items-center mb-4 pb-3 border-bottom">
          <div>
            <div className="fw-bold"><i className="bi bi-person-circle"></i> <span id="welcomeEmail">...</span></div>
            <div className="small text-muted">Vai trò: <span id="welcomeRole" className="badge bg-info">...</span></div>
          </div>
          <div>
            <button className="btn btn-outline-secondary btn-sm me-1" onClick={() => window.ui.openChangePin()}>Đổi PIN</button>
            <button className="btn btn-outline-danger btn-sm" onClick={() => window.ui.logout()}>Thoát</button>
          </div>
        </div>

        <div className="row g-3 mb-4">
          <div className="col-md-6">
            <label className="form-label fw-bold">Dự án</label>
            <select id="project" className="form-select" onChange={() => window.ui.loadPackages()}>
              <option value="">-- Chọn dự án --</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label fw-bold">Gói thầu</label>
            <select id="pkg" className="form-select">
              <option value="">-- Chọn gói thầu --</option>
            </select>
          </div>
        </div>

        <div className="card bg-light border-0 p-3">
          <label className="form-label fw-bold text-primary mb-2">Chọn file PDF đã ký số</label>
          <div className="input-group mb-2">
            <input type="file" className="form-control" id="signedFile" accept=".pdf" />
            <button className="btn btn-success fw-bold" id="btnSave" disabled onClick={() => window.ui.uploadSignedOnly()}>Nộp hồ sơ</button>
          </div>
          <div id="fileValidationAlert" className="alert d-none py-2 small"></div>
          <div id="uploadResultAlert" className="alert d-none mt-2"></div>
        </div>
      </div>

      {/* PIN Modal */}
      <div className="modal fade" id="pinModal" tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header"><h5>Đổi mã PIN</h5></div>
            <div className="modal-body">
              <input type="password" id="pinOld" className="form-control mb-2" placeholder="PIN cũ" />
              <input type="password" id="pinNew" className="form-control mb-2" placeholder="PIN mới" />
              <input type="password" id="pinNew2" className="form-control" placeholder="Nhập lại PIN mới" />
              <div id="pinMsg" className="text-danger small mt-2"></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => window.ui.changePin()}>Xác nhận</button>
            </div>
          </div>
        </div>
      </div>

      <footer className="text-center mt-4 text-muted small">&copy; 2026 Nguyễn Ngọc Nguyên</footer>
    </div>
  )
}
