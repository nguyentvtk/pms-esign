// src/app/api/verify/route.js
import forge from 'node-forge';

const EXPECTED_SP_ID = "pms_esign_commune";
const EXPECTED_TOKEN = "chuoi_bi_mat_khong_ai_biet_123";

export async function POST(request) {
  try {
    const { sp_id, token, file_base64 } = await request.json();

    // 1. Kiểm tra thông tin định danh (Bảo mật tầng API)
    if (sp_id !== EXPECTED_SP_ID || token !== EXPECTED_TOKEN) {
      return Response.json({ message: 'Unauthorized: Sai mã định danh hoặc token bảo mật.' }, { status: 401 });
    }

    if (!file_base64) {
      return Response.json({ message: 'Bad Request: Thiếu dữ liệu file b64.' }, { status: 400 });
    }

    // 2. Chuyển đổi dữ liệu chuỗi Base64 thành Buffer
    const pdfBuffer = Buffer.from(file_base64, 'base64');
    const pdfString = pdfBuffer.toString('binary');

    // 3. Quét tìm tất cả các cấu trúc chữ ký số (/Type /Sig) và /ByteRange
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

    const signaturesInfo = [];
    let allSignaturesValid = true;

    // Duyệt qua từng layer chữ ký được tìm thấy
    for (let i = 0; i < byteRangeMatches.length; i++) {
      const match = byteRangeMatches[i];
      const a = parseInt(match[1]);
      const b = parseInt(match[2]);
      const c = parseInt(match[3]);
      const d = parseInt(match[4]);

      // Vùng trống chữ ký nằm ở giữa byte a+b và c
      const signatureHexBuffer = pdfBuffer.slice(a + b, c);
      let signatureHex = signatureHexBuffer.toString('binary').trim();

      // Bỏ ký tự bọc < ở đầu và > ở cuối nếu có
      if (signatureHex.startsWith('<')) signatureHex = signatureHex.substring(1);
      if (signatureHex.endsWith('>')) signatureHex = signatureHex.substring(0, signatureHex.length - 1);

      // Làm sạch chuỗi Hex để loại bỏ các byte null padding (00) ở cuối
      let hexClean = signatureHex.replace(/\s+/g, '');
      let lastNonZero = hexClean.length - 1;
      while (lastNonZero >= 0 && hexClean[lastNonZero] === '0') {
        lastNonZero--;
      }
      const actualLength = lastNonZero % 2 === 0 ? lastNonZero + 2 : lastNonZero + 1;
      hexClean = hexClean.substring(0, actualLength);

      if (hexClean.length < 512) {
        signaturesInfo.push({
          isValid: false,
          signerName: `Chữ ký số ${i + 1}`,
          error: "Dữ liệu chữ ký số không hợp lệ hoặc quá ngắn."
        });
        allSignaturesValid = false;
        continue;
      }

      try {
        // Giải mã Hex -> Bytes
        const signatureBytes = forge.util.hexToBytes(hexClean);

        // Tạo buffer dữ liệu được ký (phần 1: 0 đến b, phần 2: c đến c+d)
        const part1 = pdfBuffer.slice(a, a + b);
        const part2 = pdfBuffer.slice(c, c + d);
        const signedDataBuffer = Buffer.concat([part1, part2]);

        // Parse CMS / PKCS#7 bằng node-forge
        const asn1 = forge.asn1.fromDer(signatureBytes);
        const message = forge.pkcs7.messageFromAsn1(asn1);

        // Gắn dữ liệu để verify
        const dataBuffer = forge.util.createBuffer(signedDataBuffer.toString('binary'), 'binary');
        message.content = dataBuffer;

        // Thực hiện xác thực mật mã học
        const verified = message.verify();

        // Trích xuất chứng thư số của người ký
        let signerName = "Không xác định";
        let certInfo = null;
        
        if (message.certificates && message.certificates.length > 0) {
          // Thường chứng thư đầu tiên là của người ký
          const cert = message.certificates[0];
          
          // Trích xuất Common Name (CN) từ Subject
          const cnAttr = cert.subject.attributes.find(attr => attr.name === 'commonName' || attr.shortName === 'CN');
          signerName = cnAttr ? cnAttr.value : "Không xác định";

          // Trích xuất CA phát hành từ Issuer
          const issuerCnAttr = cert.issuer.attributes.find(attr => attr.name === 'commonName' || attr.shortName === 'CN');
          const issuerName = issuerCnAttr ? issuerCnAttr.value : "Không xác định";

          certInfo = {
            subject: cert.subject.attributes.map(a => `${a.shortName || a.name}=${a.value}`).join(', '),
            issuer: issuerName,
            validFrom: cert.validity.notBefore,
            validTo: cert.validity.notAfter
          };

          // Kiểm tra thời hạn hiệu lực của chứng thư số
          const now = new Date();
          const validFrom = new Date(cert.validity.notBefore);
          const validTo = new Date(cert.validity.notAfter);
          
          if (now < validFrom || now > validTo) {
            signaturesInfo.push({
              isValid: false,
              signerName,
              issuer: issuerName,
              error: `Chứng thư số đã hết hạn hoặc chưa có hiệu lực (Hiệu lực: ${validFrom.toLocaleDateString('vi-VN')} - ${validTo.toLocaleDateString('vi-VN')})`
            });
            allSignaturesValid = false;
            continue;
          }
        }

        if (!verified) {
          signaturesInfo.push({
            isValid: false,
            signerName,
            error: "Mã băm của tài liệu không khớp với chữ ký số (Văn bản đã bị thay đổi cấu trúc sau khi ký)."
          });
          allSignaturesValid = false;
        } else {
          signaturesInfo.push({
            isValid: true,
            signerName,
            issuer: certInfo ? certInfo.issuer : "Không xác định",
            validTo: certInfo ? certInfo.validTo : null
          });
        }
      } catch (err) {
        signaturesInfo.push({
          isValid: false,
          signerName: `Chữ ký số ${i + 1}`,
          error: `Lỗi giải mã mật mã học chữ ký: ${err.message}`
        });
        allSignaturesValid = false;
      }
    }

    // 4. Kiểm tra đột biến cấu trúc nhị phân để phát hiện chèn đè hình ảnh bổ sung ngoài ByteRange cuối cùng
    const lastMatch = byteRangeMatches[byteRangeMatches.length - 1];
    const lastA = parseInt(lastMatch[1]), lastB = parseInt(lastMatch[2]);
    const lastC = parseInt(lastMatch[3]), lastD = parseInt(lastMatch[4]);
    const totalSignedLength = lastA + lastB + lastC + lastD;
    const actualFileSize = pdfBuffer.length;

    if (actualFileSize > totalSignedLength + 10) {
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
      // Tìm các lỗi chi tiết để phản hồi
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
