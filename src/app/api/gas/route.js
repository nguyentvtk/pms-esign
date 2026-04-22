/**
 * Next.js API Route — Server-side proxy to Google Apps Script
 * Browsers cannot call GAS directly (CORS). This route runs on Vercel's
 * Node.js server which has no CORS restriction.
 */

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbwsdDcAf5QhXW_2Zhbc9yvASh2qkamXgwlMvqKshUv0WrceFy1WljPRq-sbj0_ALlso6g/exec';

export async function POST(request) {
  try {
    const body = await request.json();

    const gasResponse = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      redirect: 'follow',
    });

    const text = await gasResponse.text();

    // GAS sometimes returns HTML on errors — try to parse JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json(
        { ok: false, message: 'GAS trả về phản hồi không hợp lệ: ' + text.slice(0, 200) },
        { status: 502 }
      );
    }

    return Response.json(data);
  } catch (err) {
    return Response.json(
      { ok: false, message: err.message || 'Lỗi kết nối đến GAS' },
      { status: 500 }
    );
  }
}
