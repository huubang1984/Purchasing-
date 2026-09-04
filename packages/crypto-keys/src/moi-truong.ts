// ==============================================================================================
// HÀNG RÀO MÔI TRƯỜNG — MỘT PHÉP KIỂM, KHÔNG MỘT KHẢ NĂNG NÀO
//
// File này ra đời ở S1.5 và nó ra đời vì một lý do có tên: `packages/bidding` cần ĐÚNG hàng rào
// fail-closed mà `local-dev-wrapper.ts` đã có ("adapter local-dev không được chạy ở production"),
// và có hai cách lấy nó — chép lại, hoặc dùng chung.
//
// Chép lại là sai, và dự án đã có tên cho cái sai ấy: **hai bản chép của một hàng rào là một bản
// sẽ trôi.** Một lần sửa hàng rào ở đây mà quên bản kia cho ra một adapter chạy được ở production
// mà không ai kêu — đúng thứ phát hiện I6 (fix round 1 của Task 7) đã dựng hàng rào này để chặn.
//
// Nhưng dùng chung KHÔNG làm được nếu hàm ở lại `local-dev-shared.ts`: quy tắc
// `g1-khong-giai-ma-ngoai-unseal-worker-local-dev-shared-ts` cấm mọi module ngoài ba module cài
// đặt import file ấy, và cấm ĐÚNG — `deriveOrgKey` cộng `node:crypto` là đủ để tự giải mã. Kể cả
// `index.ts` cũng không được re-export từ đó.
//
// Vì vậy hàm được TÁCH sang một file KHÔNG MANG KHẢ NĂNG NÀO. File này đọc hai biến môi trường và
// ném hoặc không ném; nó không có khoá, không dẫn xuất khoá, không mã hoá, không giải mã. Mở nó
// qua `index.ts` không cho ai thêm một bậc tự do nào — điều KHÔNG đúng với `local-dev-shared.ts`.
// ==============================================================================================

import { KeyError } from "./types.js";

/**
 * Chặn adapter "local-dev" chạy khi `NODE_ENV=production`, trừ khi có cờ ghi đè tường minh.
 *
 * Master key được caller tiêm và validate đúng 32 byte, không có khóa cứng hay mặc định —
 * nhưng tín hiệu DUY NHẤT phân biệt "local-dev" (mã hóa nội bộ, không qua HSM/KMS) với một
 * adapter KMS/Vault thật là chuỗi `name === "local-dev"`, và không có gì kiểm tín hiệu đó.
 * Nếu adapter này vô tình được nối dây vào production, private key coi như chưa từng có
 * HSM bảo vệ. Fail-closed ở đây, không phải một cảnh báo im lặng (bất biến G1, phát hiện I6
 * ở fix round 1).
 */
export function assertLocalDevAllowed(): void {
  // Chuẩn hóa .trim().toLowerCase() và chấp nhận cả "prod" (fix round 2, phát hiện N3):
  // so khớp === "production" đúng ký tự bị người vận hành gõ "Production"/"PRODUCTION"/"prod"
  // lúc deploy làm im lặng tắt — một hàng rào fail-closed thua một biến môi trường viết hoa
  // không đáng có.
  const moiTruong = (process.env["NODE_ENV"] ?? "").trim().toLowerCase();
  const laProduction = moiTruong === "production" || moiTruong === "prod";
  const choPhepGhiDe = process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"] === "1";
  if (laProduction && !choPhepGhiDe) {
    throw new KeyError(
      'Adapter "local-dev" bị chặn khi NODE_ENV=production. Dùng adapter KMS/Vault thật, ' +
        "hoặc đặt TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS=1 nếu bạn chắc chắn muốn ghi đè (không khuyến khích).",
    );
  }
}

