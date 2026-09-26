// ==============================================================================================
// tools/pilot-gia-lap — ĐỌC HỘP THƯ DEV CỦA `apps/api`
//
// Hộp thư dev ghi mỗi tin một tệp JSON, nguyên tử (`.tmp` rồi `rename`), tên sắp theo thứ tự gửi
// (`apps/api/src/adapters/hop-thu-dev.ts`). Bộ giả lập là người đọc DUY NHẤT của nó trong một lượt
// chạy: link đăng nhập của người mua, link mời và mã OTP của nhà cung cấp, thông báo gia hạn.
//
// Hình dạng tin được CHÉP ở đây thay vì import: `tools/` không import `apps/` (biên giới gói), và một
// tin sai hình dạng làm bước chờ hết hạn chứ không làm lượt chạy tin nhầm — `docTin` bỏ qua mọi tệp
// không đúng một trong năm hình dạng.
//
// HAI ĐIỀU CHỐNG ĐỌC NHẦM:
//   ⑴ lúc mở, mọi tệp ĐANG CÓ bị coi là đã đọc — một hộp thư dùng lại giữa hai lượt chạy giữ OTP của
//      lượt trước, và tin OTP không mang `orgId` để lọc;
//   ⑵ một tin chỉ được nhận MỘT lần — hai lần chờ liên tiếp cùng một đích không bao giờ trả cùng tệp.
// ==============================================================================================

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type TinHopThu =
  | { readonly loai: "LOGIN_LINK"; readonly orgId: string; readonly den: string; readonly duongLink: string }
  | {
      readonly loai: "INVITATION_LINK";
      readonly orgId: string;
      readonly invitationId: string;
      readonly kenh: string;
      readonly den: string;
      readonly duongLink: string;
    }
  | { readonly loai: "OTP"; readonly kenh: string; readonly den: string; readonly ma: string }
  | { readonly loai: "DEADLINE_NOTICE"; readonly orgId: string; readonly invitationId: string; readonly den: string; readonly hanNopMoi: string }
  | { readonly loai: "UNSEAL_APPROVAL_NOTICE"; readonly orgId: string; readonly den: string; readonly rfqId: string };

function chuoi(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

/** Hình dạng tin, hay `null` nếu tệp không phải một tin mà bộ giả lập biết đọc. */
export function docTin(tho: unknown): TinHopThu | null {
  if (tho === null || typeof tho !== "object") return null;
  const o = tho as Record<string, unknown>;
  const loai = chuoi(o, "loai");
  const den = chuoi(o, "den");
  if (den === undefined) return null;
  if (loai === "LOGIN_LINK") {
    const orgId = chuoi(o, "orgId");
    const duongLink = chuoi(o, "duongLink");
    return orgId === undefined || duongLink === undefined ? null : { loai, orgId, den, duongLink };
  }
  if (loai === "INVITATION_LINK") {
    const orgId = chuoi(o, "orgId");
    const invitationId = chuoi(o, "invitationId");
    const kenh = chuoi(o, "kenh");
    const duongLink = chuoi(o, "duongLink");
    if (orgId === undefined || invitationId === undefined || kenh === undefined || duongLink === undefined) return null;
    return { loai, orgId, invitationId, kenh, den, duongLink };
  }
  if (loai === "OTP") {
    const kenh = chuoi(o, "kenh");
    const ma = chuoi(o, "ma");
    return kenh === undefined || ma === undefined ? null : { loai, kenh, den, ma };
  }
  if (loai === "DEADLINE_NOTICE") {
    const orgId = chuoi(o, "orgId");
    const invitationId = chuoi(o, "invitationId");
    const hanNopMoi = chuoi(o, "hanNopMoi");
    if (orgId === undefined || invitationId === undefined || hanNopMoi === undefined) return null;
    return { loai, orgId, invitationId, den, hanNopMoi };
  }
  if (loai === "UNSEAL_APPROVAL_NOTICE") {
    const orgId = chuoi(o, "orgId");
    const rfqId = chuoi(o, "rfqId");
    return orgId === undefined || rfqId === undefined ? null : { loai, orgId, den, rfqId };
  }
  return null;
}

/** Token sau dấu `#` của một đường link (`…/login#<token>`, `…/i#<token>`). */
export function tokenTuLink(duongLink: string): string {
  const i = duongLink.indexOf("#");
  const t = i < 0 ? "" : duongLink.slice(i + 1);
  if (!/^[A-Za-z0-9_-]{16,}$/u.test(t)) throw new Error("đường link trong hộp thư không mang token đúng hình dạng");
  return t;
}

export class HopThuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HopThuError";
  }
}

export class HopThu {
  private readonly daDoc = new Set<string>();
  private readonly daNhan = new Set<string>();
  private readonly boDem = new Map<string, TinHopThu | null>();

  private constructor(private readonly thuMuc: string) {}

  /** Mở hộp thư và coi mọi tin đang có là CŨ — xem ⑴ ở đầu tệp. */
  static async mo(thuMuc: string): Promise<HopThu> {
    const h = new HopThu(thuMuc);
    for (const ten of await h.lietKe()) h.daNhan.add(ten);
    return h;
  }

  private async lietKe(): Promise<readonly string[]> {
    try {
      return (await readdir(this.thuMuc)).filter((t) => t.endsWith(".json")).sort();
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return [];
      throw e;
    }
  }

  private async doc(ten: string): Promise<TinHopThu | null> {
    if (this.boDem.has(ten)) return this.boDem.get(ten) ?? null;
    let tin: TinHopThu | null;
    try {
      tin = docTin(JSON.parse(await readFile(join(this.thuMuc, ten), "utf8")) as unknown);
    } catch {
      tin = null;
    }
    this.boDem.set(ten, tin);
    this.daDoc.add(ten);
    return tin;
  }

  /** Tin MỚI đầu tiên khớp `loc`; chờ tối đa `choMs`. Tin được nhận thì không bao giờ trả lại lần nữa. */
  async cho(moTa: string, loc: (t: TinHopThu) => boolean, choMs = 20_000): Promise<TinHopThu> {
    const han = Date.now() + choMs;
    for (;;) {
      for (const ten of await this.lietKe()) {
        if (this.daNhan.has(ten)) continue;
        const tin = await this.doc(ten);
        if (tin !== null && loc(tin)) {
          this.daNhan.add(ten);
          return tin;
        }
      }
      if (Date.now() > han) throw new HopThuError(`hết ${choMs} ms mà hộp thư chưa có ${moTa}`);
      await new Promise((xong) => setTimeout(xong, 100));
    }
  }

  /** Đếm các tin MỚI (chưa nhận) khớp `loc` mà không nhận chúng — dùng để đo số thông báo gia hạn. */
  async dem(loc: (t: TinHopThu) => boolean): Promise<number> {
    let n = 0;
    for (const ten of await this.lietKe()) {
      if (this.daNhan.has(ten)) continue;
      const tin = await this.doc(ten);
      if (tin !== null && loc(tin)) n += 1;
    }
    return n;
  }

  /** Tin OTP MỚI NHẤT (kể cả đã nhận) gửi tới `den` — cho lệnh `otp` của người trình diễn. */
  async otpMoiNhat(den: string): Promise<{ readonly ma: string; readonly ten: string } | null> {
    const ds = [...(await this.lietKe())].reverse();
    for (const ten of ds) {
      const tin = await this.doc(ten);
      if (tin !== null && tin.loai === "OTP" && tin.den === den) return { ma: tin.ma, ten };
    }
    return null;
  }
}
