// src/app/api/verify-file/route.js
import verifyPDF from '@qlever-llc/verify-pdf';

// Hàm khôi phục chuỗi Tiếng Việt bị lỗi font (mojibake) do decode sai sang Latin1
function cleanMojibake(str) {
  if (!str) return '';
  try {
    // Thử convert từ latin1 sang utf-8
    const cleaned = Buffer.from(str, 'latin1').toString('utf8');
    // Nếu chuỗi chứa các ký tự unicode hợp lệ thì trả về
    return cleaned;
  } catch (e) {
    return str;
  }
}

// Hàm kiểm tra danh sách CA Việt Nam được tin cậy
function checkTrustedCA(issuerName) {
  const cleaned = cleanMojibake(issuerName);
  const normalized = cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const trustedKeywords = [
    'co yeu chinh phu',
    'chinh phu',
    'neac',
    'nha nuoc',        // Cho "CA phục vụ các cơ quan Nhà nước"
    'ban co yeu',      // Cho "Ban Cơ yếu"
    'co quan',
    'vnpt',
    'viettel',
    'fpt',
    'bkav',
    'misa',
    'smartsign',
    'trustca',
    'ca2',
    'nacencomm',
    'cyberlotus',
    'safecert',
    'efy',
    'vigna',
    'lc-ca',
    'origin'
  ];
  return trustedKeywords.some(kw => normalized.includes(kw));
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return Response.json({ message: 'Bad Request: Thiếu dữ liệu file PDF.' }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const pdfString = pdfBuffer.toString('binary');

    // 1. Quét tìm tất cả các cấu trúc chữ ký số và ByteRange bằng regex để kiểm tra tính toàn vẹn file
    const sigRegex = /\/Type\s*\/Sig/g;
    const sigMatches = [...pdfString.matchAll(sigRegex)];

    const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
    const byteRangeMatches = [...pdfString.matchAll(byteRangeRegex)];

    if (sigMatches.length === 0 || byteRangeMatches.length === 0) {
      return Response.json({
        hasSignature: false,
        isValid: false,
        message: "Tài liệu chưa được thực hiện ký số."
      });
    }

    // 2. Sử dụng thư viện @qlever-llc/verify-pdf để xác thực mật mã học
    let result;
    try {
      result = verifyPDF(pdfBuffer);
    } catch (err) {
      return Response.json({
        hasSignature: true,
        isValid: false,
        message: `Lỗi cấu trúc tệp PDF hoặc chữ ký: ${err.message}`
      });
    }

    if (!result.signatures || result.signatures.length === 0) {
      return Response.json({
        hasSignature: false,
        isValid: false,
        message: "Tài liệu chưa được thực hiện ký số."
      });
    }

    const signaturesInfo = [];
    let allSignaturesValid = true;

    result.signatures.forEach((sig, index) => {
      const cert = sig.meta && sig.meta.certs && sig.meta.certs[0];
      let rawSignerName = cert && cert.issuedTo ? (cert.issuedTo.commonName || "Không xác định") : `Chữ ký số ${index + 1}`;
      let rawIssuerName = cert && cert.issuedBy ? (cert.issuedBy.commonName || cert.issuedBy.organizationName || "Không xác định") : "Không xác định";

      // Làm sạch chuỗi hiển thị
      const signerName = cleanMojibake(rawSignerName);
      const issuerName = cleanMojibake(rawIssuerName);

      const integrityOk = sig.integrity === true;
      const expired = sig.expired === true;
      const isTrustedCA = checkTrustedCA(rawIssuerName) || sig.authenticity === true;

      let isValidSig = integrityOk && !expired && isTrustedCA;
      let error = "";
      if (!integrityOk) {
        error = "Chữ ký bị hỏng tính toàn vẹn (Văn bản bị sửa đổi sau khi thực hiện chữ ký này).";
      } else if (expired) {
        error = "Chứng thư số đã hết hạn hoặc chưa có hiệu lực.";
      } else if (!isTrustedCA) {
        error = `Chữ ký được cấp bởi CA không được tin cậy hoặc tự ký (${issuerName}).`;
      }

      if (!isValidSig) {
        allSignaturesValid = false;
      }

      signaturesInfo.push({
        isValid: isValidSig,
        signerName,
        issuer: issuerName,
        error: error || undefined
      });
    });

    // 3. Kiểm tra chèn đè tệp nhị phân sau chữ ký cuối cùng (expected size = c + d)
    const lastMatch = byteRangeMatches[byteRangeMatches.length - 1];
    const lastC = parseInt(lastMatch[3]);
    const lastD = parseInt(lastMatch[4]);
    const expectedFileSize = lastC + lastD;
    const actualFileSize = pdfBuffer.length;

    if (actualFileSize > expectedFileSize + 10) {
      allSignaturesValid = false;
      signaturesInfo.push({
        isValid: false,
        signerName: "Kiểm tra cấu trúc tệp PDF",
        error: "Kích thước tệp thực tế lớn hơn vùng dữ liệu được ký mật mã (Tài liệu bị chèn đè hình ảnh con dấu hoặc chỉnh sửa sau khi ký phát hành)."
      });
    }

    if (allSignaturesValid) {
      return Response.json({
        hasSignature: true,
        isValid: true,
        signatures: signaturesInfo,
        message: "Xác thực chữ ký số mật mã học thành công. Tài liệu toàn vẹn pháp lý."
      });
    } else {
      const errors = signaturesInfo.filter(s => !s.isValid).map(s => `${s.signerName}: ${s.error}`);
      return Response.json({
        hasSignature: true,
        isValid: false,
        signatures: signaturesInfo,
        message: `Xác thực chữ ký số thất bại. Chi tiết lỗi:\n- ${errors.join('\n- ')}`
      });
    }

  } catch (error) {
    return Response.json({ message: 'Lỗi xử lý hệ thống bên trong backend: ' + error.message }, { status: 500 });
  }
}
