/**
 * Next.js API Route — Server-side proxy to Google Apps Script
 * GAS doPost requires a multi-step redirect flow.
 * We follow all redirects and parse the final JSON response.
 */

const GAS_EXEC_URL =
  'https://script.google.com/macros/s/AKfycbwsdDcAf5QhXW_2Zhbc9yvASh2qkamXgwlMvqKshUv0WrceFy1WljPRq-sbj0_ALlso6g/exec';

export async function POST(request) {
  let text = '';
  try {
    const body = await request.json();

    // Step 1: POST to GAS — expect a 302 redirect to the actual endpoint
    const res1 = await fetch(GAS_EXEC_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // GAS doPost reads e.postData.contents — send as-is inside a form field
      body: 'payload=' + encodeURIComponent(JSON.stringify(body)),
      redirect: 'follow',
    });

    text = await res1.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON — likely GAS returned HTML (script not deployed with doPost yet)
      console.error('[GAS Proxy] Non-JSON response (HTTP ' + res1.status + '):', text.slice(0, 500));
      return Response.json(
        {
          ok: false,
          message:
            'Google Apps Script chưa được cập nhật. Vui lòng copy Code.gs mới nhất vào GAS Editor và Deploy lại (New Deployment). HTTP: ' +
            res1.status,
        },
        { status: 502 }
      );
    }

    return Response.json(data);
  } catch (err) {
    console.error('[GAS Proxy] Fetch error:', err.message, '| Raw response:', text.slice(0, 300));
    return Response.json(
      { ok: false, message: 'Lỗi kết nối đến GAS: ' + (err.message || String(err)) },
      { status: 500 }
    );
  }
}

