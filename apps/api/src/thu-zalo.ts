// ==============================================================================================
// apps/api/src/thu-zalo.ts — GỬI THỬ MỘT TIN ZALO ZNS THẬT, BẰNG ĐÚNG ADAPTER CỦA `api` (ADR-069)
//
// `adapters/gui-zalo.ts` viết theo tài liệu công khai của Zalo và CHƯA từng gọi API thật. Công cụ này gọi nó một
// lần, qua đúng kho token Secrets Manager (`tp/api/zalo-oa`) mà `api` dùng, để đo trước khi có nhà cung cấp thật:
//   ⑴ cấp token — làm mới từ refresh token người vận hành đã nạp, rồi GHI LẠI vào secret;
//   ⑵ hình dạng lời gọi ZNS — Zalo nhận hay trả mã lỗi gì;
//   ⑶ từng template đã duyệt nhận đúng tham số, ở đúng độ dài sản phẩm sẽ gửi (`duong_dan` ~112 ký tự).
//
// Chạy LÚC VẬN HÀNH, từ máy người vận hành, với quyền Get/Put trên secret ấy (profile tp-prod):
//   $env:AWS_PROFILE = "tp-prod"
//   pnpm thu-zalo --chi-doc-secret                                   # đọc và kiểm hình dạng secret; không gọi Zalo
//   pnpm thu-zalo --loai otp --so <số của bạn> --template <ID template OTP>
//   pnpm thu-zalo --loai loi-moi --so <số> --template <ID template lời mời>
//   pnpm thu-zalo --loai gia-han --so <số> --template <ID template gia hạn>
//
// LÀM MỚI TOKEN LÀ THẬT: refresh token chỉ dùng một lần; lần gửi đầu sau khi nạp secret sẽ xoay nó rồi ghi lại —
// đúng như `api`. Đừng chạy khi `api` đang chạy trên prod: hai bên cùng làm mới có thể giẫm nhau (ADR-069).
// Tin mời mang một đường dẫn GIẢ cùng độ dài thật (mã tổ chức và token ngẫu nhiên, không trỏ tới lời mời nào).
// Không in token, secret hay số điện thoại đầy đủ. Mã thoát: 0 xong · 1 Zalo/secret từ chối · 2 sai tham số ·
// 3 token đã xoay mà KHÔNG ghi được vào secret (phải cấp lại refresh token NGAY).
// ==============================================================================================

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ZaloTokenMatError, taoBoGuiZalo, type KhoTokenZalo } from "./adapters/gui-zalo.js";
import { GuiKenhError, chuanHoaE164 } from "./adapters/kenh-so.js";
import { taoKhoTokenZaloSecretsManager } from "./adapters/kho-token-zalo.js";

export const LOAI_TIN = ["otp", "loi-moi", "gia-han"] as const;
export type LoaiTin = (typeof LOAI_TIN)[number];

export interface ThamSoThuZalo {
  readonly chiDocSecret: boolean;
  readonly loai?: LoaiTin;
  readonly so?: string;
  readonly template?: string;
  readonly secret: string;
  readonly region: string;
  readonly tenMien: string;
}

export const CACH_DUNG_THU_ZALO =
  "cách dùng: pnpm thu-zalo --chi-doc-secret | pnpm thu-zalo --loai otp|loi-moi|gia-han --so <+84…|0…> --template <ID> " +
  "[--secret tp/api/zalo-oa] [--region ap-southeast-1] [--ten-mien trustprocure.jinji.vn]";

export class ThamSoSaiError extends Error {
  constructor(message: string) {
    super(`${message}\n${CACH_DUNG_THU_ZALO}`);
    this.name = "ThamSoSaiError";
  }
}

export function docThamSoThuZalo(argv: readonly string[]): ThamSoThuZalo {
  const gt = new Map<string, string>();
  let chiDocSecret = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--chi-doc-secret") {
      chiDocSecret = true;
      continue;
    }
    if (!["--loai", "--so", "--template", "--secret", "--region", "--ten-mien"].includes(a)) throw new ThamSoSaiError(`tham số lạ: ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new ThamSoSaiError(`${a} thiếu giá trị`);
    gt.set(a, v);
    i += 1;
  }
  const loai = gt.get("--loai");
  if (loai !== undefined && !(LOAI_TIN as readonly string[]).includes(loai)) throw new ThamSoSaiError(`--loai phải là một trong ${LOAI_TIN.join(", ")}`);
  const t: ThamSoThuZalo = {
    chiDocSecret,
    loai: loai as LoaiTin | undefined,
    so: gt.get("--so"),
    template: gt.get("--template"),
    secret: gt.get("--secret") ?? "tp/api/zalo-oa",
    region: gt.get("--region") ?? "ap-southeast-1",
    tenMien: gt.get("--ten-mien") ?? "trustprocure.jinji.vn",
  };
  if (!chiDocSecret && (t.loai === undefined || t.so === undefined || t.template === undefined)) {
    throw new ThamSoSaiError("gửi thử cần đủ --loai, --so và --template");
  }
  if (t.template !== undefined && !/^[0-9]{1,20}$/u.test(t.template)) throw new ThamSoSaiError("--template là ID số của template ZNS đã duyệt");
  return t;
}

/** Giá trị tham số của từng loại tin — cùng hình dạng sản phẩm gửi (`kenh-so.ts`, `invitation.ts`). */
export function giaTriThu(loai: LoaiTin, tenMien: string, bayGio: number): { readonly ten: string; readonly giaTri: string } {
  switch (loai) {
    case "otp":
      return { ten: "otp", giaTri: String(randomInt(0, 1_000_000)).padStart(6, "0") };
    case "loi-moi":
      return { ten: "duong_dan", giaTri: `https://${tenMien}/i#${randomUUID()}:${randomBytes(32).toString("base64url")}` };
    case "gia-han":
      return { ten: "han_nop", giaTri: new Date(bayGio + 7 * 24 * 3_600_000).toISOString() };
  }
}

/** `+84901234567` ⇒ `+84•••••4567`: đủ để nhận ra số, không đủ để chép lại. */
export function cheSo(e164: string): string {
  return e164.length <= 7 ? "•••" : `${e164.slice(0, 3)}${"•".repeat(e164.length - 7)}${e164.slice(-4)}`;
}

export interface PhuThuocThuZalo {
  readonly kho: KhoTokenZalo;
  readonly in: (dong: string) => void;
  readonly fetch?: typeof fetch;
  readonly bayGio?: () => number;
}

async function moTaKho(kho: KhoTokenZalo, bayGio: number): Promise<string> {
  const tk = await kho.doc();
  const hetHan = tk.accessToken === "" ? "chưa có access token" : `access token hết hạn lúc ${new Date(tk.hetHanLuc).toISOString()}`;
  const conLai = tk.accessToken === "" ? "" : ` (còn ${Math.round((tk.hetHanLuc - bayGio) / 60_000)} phút)`;
  return `secret: app_id có, secret_key có, refresh_token có; ${hetHan}${conLai}`;
}

export async function chayThuZalo(t: ThamSoThuZalo, d: PhuThuocThuZalo): Promise<number> {
  const bayGio = d.bayGio ?? Date.now;
  try {
    if (t.chiDocSecret) {
      d.in(await moTaKho(d.kho, bayGio()));
      return 0;
    }
    const so = chuanHoaE164(t.so!);
    const template = t.template!;
    const bo = taoBoGuiZalo({ kho: d.kho, mau: { otp: template, loiMoi: template, giaHan: template }, fetch: d.fetch, bayGio });
    const { ten, giaTri } = giaTriThu(t.loai!, t.tenMien, bayGio());
    if (t.loai === "otp") await bo.guiOtp(so, giaTri);
    else if (t.loai === "loi-moi") await bo.guiLoiMoi(so, giaTri);
    else await bo.guiGiaHan(so, giaTri);
    d.in(`Zalo ZNS: đã gửi tin ${t.loai} tới ${cheSo(so)}, template ${template}.`);
    d.in(`tham số ${ten} (${giaTri.length} ký tự): ${giaTri}`);
    d.in(await moTaKho(d.kho, bayGio()));
    return 0;
  } catch (loi) {
    if (loi instanceof ZaloTokenMatError) {
      d.in(`HỎNG: ${loi.message}. Refresh token cũ đã chết — cấp lại refresh token rồi nạp secret NGAY (README, stack 85).`);
      return 3;
    }
    if (loi instanceof GuiKenhError) {
      d.in(`HỎNG: ${loi.message}`);
      return 1;
    }
    // Lỗi của AWS SDK (secret chưa có, thiếu quyền, phiên hết hạn) mang `$metadata`: in TÊN, không in thân.
    if (loi instanceof Error && "$metadata" in loi) {
      d.in(`HỎNG: AWS từ chối khi đọc/ghi secret ${t.secret} (${loi.name}) — stack 85 đã apply chưa, AWS_PROFILE đúng chưa?`);
      return 1;
    }
    throw loi;
  }
}

async function mainThuZalo(): Promise<void> {
  let t: ThamSoThuZalo;
  try {
    t = docThamSoThuZalo(process.argv.slice(2));
  } catch (loi) {
    if (!(loi instanceof ThamSoSaiError)) throw loi;
    console.error(loi.message);
    process.exitCode = 2;
    return;
  }
  const kho = taoKhoTokenZaloSecretsManager({ client: new SecretsManagerClient({ region: t.region }), secretId: t.secret });
  process.exitCode = await chayThuZalo(t, { kho, in: (dong) => process.stdout.write(`${dong}\n`) });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mainThuZalo();
}
