// ==============================================================================================
// tools/pilot-gia-lap — ĐỌC DÒNG LỆNH (hàm thuần)
//
//   pnpm pilot:gia-lap [chay] [--cham] [--chi SX-01,XD-02] [--dung-sau]   chạy danh mục, giữ cụm cho trình diễn
//   pnpm pilot:gia-lap cum                                                  chỉ dựng lại cụm (dùng lại khoá), giữ chạy
//   pnpm pilot:gia-lap dang-nhap <email> [orgId]                            link đăng nhập mới + mã TOTP hiện tại
//   pnpm pilot:gia-lap otp <số điện thoại>                                  mã OTP mới nhất gửi tới số ấy
//   pnpm pilot:gia-lap lien-ket                                             link mời còn chờ nộp của các gói để lại
//
// Tuỳ chọn chung: --thu-muc <dir> (mặc định `<gốc kho>/.pilot-gia-lap`), --cong-api/--cong-web/--cong-khoa <cổng>.
// ==============================================================================================

import type { CongCum } from "./cum.js";

export type Lenh = "chay" | "cum" | "dang-nhap" | "otp" | "lien-ket" | "tro-giup";

export interface ThamSo {
  readonly lenh: Lenh;
  readonly cham: boolean;
  readonly dungSau: boolean;
  readonly chi: readonly string[];
  readonly thuMuc: string | null;
  readonly cong: CongCum;
  readonly doiSo: readonly string[];
}

export class ThamSoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThamSoError";
  }
}

const LENH: readonly Lenh[] = ["chay", "cum", "dang-nhap", "otp", "lien-ket", "tro-giup"];

function cong(v: string | undefined, ten: string): number {
  if (v === undefined || !/^\d{2,5}$/u.test(v)) throw new ThamSoError(`${ten} cần một số cổng`);
  const n = Number(v);
  if (n < 1024 || n > 65535) throw new ThamSoError(`${ten} phải trong 1024–65535`);
  return n;
}

export function docThamSo(argv: readonly string[], macDinh: CongCum): ThamSo {
  let lenh: Lenh = "chay";
  let cham = false;
  let dungSau = false;
  let chi: string[] = [];
  let thuMuc: string | null = null;
  const c: { api: number; web: number; khoa: number } = { api: macDinh.api, web: macDinh.web, khoa: macDinh.khoa };
  const doiSo: string[] = [];
  let i = 0;
  const dau = argv[0];
  if (dau !== undefined && !dau.startsWith("--")) {
    if (dau === "--help" || dau === "-h") lenh = "tro-giup";
    else if ((LENH as readonly string[]).includes(dau)) lenh = dau as Lenh;
    else throw new ThamSoError(`lệnh lạ "${dau}" — dùng một trong: ${LENH.join(", ")}`);
    i = 1;
  }
  for (; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    switch (a) {
      case "--cham":
        cham = true;
        break;
      case "--dung-sau":
        dungSau = true;
        break;
      case "--help":
      case "-h":
        lenh = "tro-giup";
        break;
      case "--chi":
        i += 1;
        chi = (argv[i] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => s !== "");
        if (chi.length === 0) throw new ThamSoError("--chi cần danh sách mã kịch bản, ví dụ SX-01,XD-02");
        break;
      case "--thu-muc":
        i += 1;
        thuMuc = argv[i] ?? null;
        if (thuMuc === null || thuMuc.trim() === "") throw new ThamSoError("--thu-muc cần một đường dẫn");
        break;
      case "--cong-api":
        i += 1;
        c.api = cong(argv[i], a);
        break;
      case "--cong-web":
        i += 1;
        c.web = cong(argv[i], a);
        break;
      case "--cong-khoa":
        i += 1;
        c.khoa = cong(argv[i], a);
        break;
      default:
        if (a.startsWith("--")) throw new ThamSoError(`tuỳ chọn lạ "${a}"`);
        doiSo.push(a);
    }
  }
  if (new Set([c.api, c.web, c.khoa]).size !== 3) throw new ThamSoError("ba cổng api/web/khoá phải khác nhau");
  if (lenh === "dang-nhap" && (doiSo.length < 1 || doiSo.length > 2)) throw new ThamSoError("dang-nhap cần một email, và tuỳ chọn một orgId");
  if (lenh === "otp" && doiSo.length !== 1) throw new ThamSoError("otp cần đúng một số điện thoại");
  if ((lenh === "chay" || lenh === "cum" || lenh === "lien-ket" || lenh === "tro-giup") && doiSo.length > 0) {
    throw new ThamSoError(`đối số thừa: ${doiSo.join(" ")}`);
  }
  return { lenh, cham, dungSau, chi, thuMuc, cong: c, doiSo };
}

export const TRO_GIUP = `pilot giả lập TrustProcure — công cụ DEV, không phải pilot thật

  pnpm pilot:gia-lap [chay] [--cham] [--chi SX-01,XD-02] [--dung-sau]
      Dựng cụm cục bộ (api, worker, web, khoá công khai), gieo hai doanh nghiệp giả lập, chạy danh
      mục kịch bản qua API thật, ghi báo cáo, rồi GIỮ cụm chạy cho buổi trình diễn (Ctrl+C để dừng).
      --cham     thêm kịch bản đợi hạn nộp thật (~65 phút)
      --dung-sau dừng cụm ngay khi chạy xong
  pnpm pilot:gia-lap cum                 dựng lại cụm từ thư mục trạng thái, giữ chạy
  pnpm pilot:gia-lap dang-nhap <email> [orgId]
                                         link đăng nhập mới + mã TOTP hiện tại của một người mua giả lập
                                         (mặc định tổ chức của lượt chạy mới nhất có email ấy)
  pnpm pilot:gia-lap otp <số điện thoại> mã OTP mới nhất gửi tới một nhà cung cấp giả lập
  pnpm pilot:gia-lap lien-ket            link mời còn chờ nộp của các gói để lại cho trình diễn

  Tuỳ chọn chung: --thu-muc <dir> · --cong-api <n> · --cong-web <n> · --cong-khoa <n>
  Biến môi trường: TRUSTPROCURE_SEED_DATABASE_URL — superuser của một Postgres 16 CỤC BỘ (chay, cum).
`;
