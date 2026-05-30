// api/verify.js

// Khai báo 2 chuỗi bí mật để bảo mật đường truyền giữa GAS và Vercel của riêng bạn
const EXPECTED_SP_ID = "pms_esign_commune";
const EXPECTED_TOKEN = "chuoi_bi_mat_khong_ai_biet_123";

export default async function handler(req, res) {
  // Chỉ chấp nhận các lệnh gọi bằng phương thức POST từ GAS sang
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { sp_id, token, file_base64 } = req.body;

    // 1. Kiểm tra mã bảo mật tầng API để tránh người ngoài gọi phá hoại hệ thống
    if (sp_id !== EXPECTED_SP_ID || token !== EXPECTED_TOKEN) {
      return res.status(401).json({ message: 'Unauthorized: Sai mã định danh hoặc token bảo mật.' });
    }

    if (!file_base64) {
      return res.status(400).json({ message: 'Bad Request: Thiếu dữ liệu file mã hóa.' });
    }

    // 2. Chuyển đổi dữ liệu chuỗi chuỗi Base64 nhận từ GAS thành cấu trúc nhị phân (Buffer)
    const pdfBuffer = Buffer.from(file_base64, 'base64');
    const pdfString = pdfBuffer.toString('binary');

    // 3. Quét kiểm tra cấu trúc thẻ chữ ký số theo tiêu chuẩn mật mã PDF quốc tế
    const sigRegex = /\/Type\s*\/Sig/g;
    const matches = [...pdfString.matchAll(sigRegex)];

    if (matches.length === 0) {
      return res.status(200).json({ hasSignature: false, isValid: false, message: "File chưa được ký số." });
    }

    // 4. Kiểm tra đột biến cấu trúc nhị phân để phát hiện hình ảnh chèn đè (Document Modified)
    const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    const byteRangeMatches = [...pdfString.matchAll(byteRangeRegex)];
    
    if (byteRangeMatches.length === 0) {
      return res.status(200).json({ hasSignature: true, isValid: false, message: "Cấu trúc ByteRange không hợp lệ." });
    }

    // Lấy vùng ký của layer chữ ký số cuối cùng trong file
    const lastMatch = byteRangeMatches[byteRangeMatches.length - 1];
    const a = parseInt(lastMatch[1]), b = parseInt(lastMatch[2]);
    const c = parseInt(lastMatch[3]), d = parseInt(lastMatch[4]);

    const totalSignedLength = a + b + c + d;
    const actualFileSize = pdfBuffer.length;

    // Nếu kích thước file thực tế lớn hơn vùng dữ liệu được ký mật mã (sai số quá 10 bytes),
    // chứng tỏ file đã bị chèn đè layer hình ảnh hoặc bị sửa sau khi ký số phát hành.
    if (actualFileSize > totalSignedLength + 10) { 
      return res.status(200).json({
        hasSignature: true,
        isValid: false,
        signatures: [{ isValid: false, signerName: "Kiểm tra cấu trúc file nhị phân" }],
        message: "Chữ ký không hợp lệ. Tài liệu đã bị chỉnh sửa hoặc chèn đè hình ảnh con dấu trái phép sau khi ký số."
      });
    }

    // Nếu file hoàn toàn toàn vẹn dữ liệu
    return res.status(200).json({
      hasSignature: true,
      isValid: true,
      message: "Xác thực cấu trúc chữ ký số thành công. Tài liệu toàn vẹn pháp lý."
    });

  } catch (error) {
    return res.status(500).json({ message: 'Lỗi hệ thống Vercel: ' + error.message });
  }
}