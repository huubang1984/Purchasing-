// ==============================================================================================
// tools/pilot-gia-lap — DIỄN VIÊN: người mua đăng nhập bằng TOTP, nhà cung cấp mở phiên bằng OTP
//
// Không đường tắt nào: người mua đi `/auth/link` → link trong hộp thư → `/auth/redeem` (lần đầu nhận
// bí mật TOTP, tức GHI DANH thật) → mã TOTP tính từ bí mật ấy → `/auth/totp` → cookie phiên. Nhà
// cung cấp đi `/guest/redeem` → `/guest/otp` qua kênh KHÁC kênh link → mã trong hộp thư →
// `/guest/otp/verify` → cookie khách. Đó là đúng đường `kich-ban-41-http.int.test.ts` đo, chỉ khác
// ở chỗ bộ gửi là hộp thư dev của một tiến trình `api` THẬT chứ không phải bộ gửi ghi nhớ của test.
//
// Hai điều của TOTP mà một lượt chạy dài vấp phải:
//   ⑴ mã đã dùng trong một bước thời gian KHÔNG dùng lại được (`CODE_ALREADY_USED`) — đăng nhập lại
//      cùng người trong cùng 30 giây phải đợi bước kế;
//   ⑵ điều phối mở thầu đòi lần xác thực TOTP gần nhất còn trong 15 phút (`MFA_FRESH`) — trước mỗi
//      lần điều phối, người điều phối đăng nhập lại nếu lần trước đã quá 10 phút.
// ==============================================================================================

import { counterForTime, deriveTotpCode } from "@trustprocure/identity";
import type { HopThu } from "./hop-thu.js";
import { tokenTuLink } from "./hop-thu.js";
import { HttpError, PhienHttp, layChuoi, lay } from "./http.js";
import type { NguoiHoSo } from "./ho-so.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function giaiMaBase32(s: string): Buffer {
  let bits = 0;
  let gia = 0;
  const ra: number[] = [];
  for (const ch of s.replace(/=+$/u, "").toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error("base32 hỏng");
    gia = ((gia << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      ra.push((gia >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(ra);
}

/** Mã TOTP hiện tại của một bí mật base32, và số giây còn lại của bước thời gian. */
export function maTotpHienTai(biMatBase32: string, bayGio = Date.now()): { readonly ma: string; readonly conGiay: number } {
  const ma = deriveTotpCode(giaiMaBase32(biMatBase32), counterForTime(bayGio));
  return { ma, conGiay: 30 - Math.floor((bayGio / 1000) % 30) };
}

export class NguoiMua {
  readonly http: PhienHttp;
  biMatTotp: string | null = null;
  private buocCuoi = -1;
  private mfaLuc = 0;

  constructor(
    readonly hoSo: NguoiHoSo,
    readonly email: string,
    readonly orgId: string,
    readonly userId: string,
    apiGoc: string,
    diaChi: string,
  ) {
    this.http = new PhienHttp(apiGoc, diaChi);
  }

  get nhan(): string {
    return `${this.hoSo.hoTen} (${this.hoSo.chucDanh})`;
  }

  /** Trọn đường đăng nhập. Trả về số mili-giây đã tốn. */
  async dangNhap(hopThu: HopThu): Promise<number> {
    const batDau = Date.now();
    const link = await this.http.goi("POST", "/auth/link", { orgId: this.orgId, email: this.email });
    if (link.status !== 200) throw new HttpError(`/auth/link ${link.status}: ${link.text}`, link.status);
    const tin = await hopThu.cho(`link đăng nhập của ${this.email}`, (t) => t.loai === "LOGIN_LINK" && t.orgId === this.orgId && t.den === this.email);
    if (tin.loai !== "LOGIN_LINK") throw new Error("tin sai loại");
    const token = tokenTuLink(tin.duongLink);
    const rd = await this.http.goi("POST", "/auth/redeem", { orgId: this.orgId, token });
    if (rd.status !== 200) throw new HttpError(`/auth/redeem ${rd.status}: ${rd.text}`, rd.status);
    if (lay(rd.body, "needsEnrollment") === true) this.biMatTotp = layChuoi(rd.body, "totpSecretBase32");
    if (this.biMatTotp === null) throw new Error(`${this.email}: đã ghi danh TOTP ở lượt trước, bộ giả lập không có bí mật`);
    // ⑴ — đợi sang bước thời gian mới nếu bước hiện tại đã dùng.
    let buoc = counterForTime(Date.now());
    while (buoc <= this.buocCuoi) {
      await new Promise((xong) => setTimeout(xong, 1000));
      buoc = counterForTime(Date.now());
    }
    const ma = deriveTotpCode(giaiMaBase32(this.biMatTotp), buoc);
    const r = await this.http.goi("POST", "/auth/totp", { orgId: this.orgId, token, code: ma });
    if (r.status !== 200) throw new HttpError(`/auth/totp ${r.status}: ${r.text}`, r.status);
    if (!this.http.coPhien()) throw new Error(`${this.email}: /auth/totp 200 mà không đặt cookie phiên`);
    this.buocCuoi = buoc;
    this.mfaLuc = Date.now();
    return Date.now() - batDau;
  }

  /** ⑵ — đăng nhập lại nếu lần xác thực TOTP gần nhất đã quá `toiDaMs`. Trả về true nếu có đăng nhập lại. */
  async damBaoMfaMoi(hopThu: HopThu, toiDaMs = 10 * 60_000): Promise<boolean> {
    if (Date.now() - this.mfaLuc <= toiDaMs) return false;
    await this.dangNhap(hopThu);
    return true;
  }
}

/** Phiên khách của MỘT lời mời — cookie khách gắn với lời mời, nên mỗi lời mời một `PhienHttp`. */
export class PhienKhach {
  readonly http: PhienHttp;

  constructor(
    readonly orgId: string,
    readonly token: string,
    readonly soDienThoai: string,
    apiGoc: string,
    diaChi: string,
  ) {
    this.http = new PhienHttp(apiGoc, diaChi);
  }

  /** Mở link, xin OTP qua SMS (link đi qua EMAIL — ADR-015 mục 1), nhập mã từ hộp thư. */
  async mo(hopThu: HopThu): Promise<void> {
    const rd = await this.http.goi("POST", "/guest/redeem", { orgId: this.orgId, token: this.token });
    if (rd.status !== 200) throw new HttpError(`/guest/redeem ${rd.status}: ${rd.text}`, rd.status);
    const kenh = lay(rd.body, "otpChannels");
    if (!Array.isArray(kenh) || !kenh.includes("SMS")) throw new Error("lời mời không cho OTP qua SMS");
    const otp = await this.http.goi("POST", "/guest/otp", { orgId: this.orgId, token: this.token, channel: "SMS" });
    if (otp.status !== 200) throw new HttpError(`/guest/otp ${otp.status}: ${otp.text}`, otp.status);
    const tin = await hopThu.cho(`mã OTP tới ${this.soDienThoai}`, (t) => t.loai === "OTP" && t.den === this.soDienThoai);
    if (tin.loai !== "OTP") throw new Error("tin sai loại");
    const v = await this.http.goi("POST", "/guest/otp/verify", { orgId: this.orgId, token: this.token, code: tin.ma });
    if (v.status !== 200) throw new HttpError(`/guest/otp/verify ${v.status}: ${v.text}`, v.status);
    if (!this.http.coPhien()) throw new Error("/guest/otp/verify 200 mà không đặt cookie khách");
  }
}
