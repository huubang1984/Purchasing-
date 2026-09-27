// ==============================================================================================
// tools/pilot-gia-lap — TRẠNG THÁI CHO BUỔI TRÌNH DIỄN (`trang-thai.json`, 0600)
//
// Thứ người trình diễn cần mà báo cáo KHÔNG được mang: bí mật TOTP của mỗi người mua giả lập (để lệnh
// `dang-nhap` in mã hiện tại), và token của những lời mời để lại cho nhà cung cấp nộp trực tiếp. Tệp
// nằm trong thư mục trạng thái 0700 (trên POSIX; trên Windows nó thừa hưởng ACL của thư mục cha), cạnh
// `cum.json`, và `.gitignore` chặn cả thư mục.
//
// Tệp GỘP qua các lượt chạy, tổ chức mới nhất trước (`gopTrangThai`): người mua của một lượt cũ đã ghi
// danh TOTP, và bí mật của họ chỉ nằm ở đây — mất nó là mất đường đăng nhập vào các gói lượt ấy để lại.
// ==============================================================================================

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface NguoiTrangThai {
  readonly ma: string;
  readonly hoTen: string;
  readonly chucDanh: string;
  readonly vai: string;
  readonly email: string;
  readonly totpBase32: string | null;
}

export interface LoiMoiTrangThai {
  readonly kichBan: string;
  readonly nhaCungCap: string;
  readonly lienHe: string;
  readonly soDienThoai: string;
  readonly token: string;
}

export interface ToChucTrangThai {
  readonly ma: string;
  readonly ten: string;
  readonly orgId: string;
  /** Lúc bắt đầu lượt chạy đã dựng tổ chức này — gom các tổ chức theo lượt. Tệp của bản đầu không có. */
  readonly luot?: string;
  readonly nguoi: readonly NguoiTrangThai[];
  readonly loiMoiConLai: readonly LoiMoiTrangThai[];
  readonly goiDeLai: readonly { readonly kichBan: string; readonly rfqId: string; readonly buocTiep: readonly string[] }[];
}

export interface TrangThai {
  readonly phienBan: 1;
  readonly taoLuc: string;
  readonly toChuc: readonly ToChucTrangThai[];
}

export function tepTrangThai(thuMuc: string): string {
  return join(thuMuc, "trang-thai.json");
}

export async function ghiTrangThai(thuMuc: string, tt: TrangThai): Promise<void> {
  const tep = tepTrangThai(thuMuc);
  const tam = `${tep}.tmp`;
  await writeFile(tam, JSON.stringify(tt, null, 2), { mode: 0o600 });
  await rename(tam, tep);
}

/**
 * Tổ chức của lượt vừa chạy đứng đầu; tổ chức của các lượt trước được GIỮ, trừ khi trùng `orgId`. Một
 * lần soi ở vòng này: bản đầu ghi đè cả tệp bằng tổ chức của lượt hiện tại, nên một lượt `--chi SX-04`
 * chạy để làm mới một gói xoá mất bí mật TOTP của người mua XD mà các gói XD-03..05 để lại cần tới.
 */
export function gopTrangThai(cu: TrangThai | null, moi: readonly ToChucTrangThai[], taoLuc: string): TrangThai {
  const idMoi = new Set(moi.map((t) => t.orgId));
  return { phienBan: 1, taoLuc, toChuc: [...moi, ...(cu?.toChuc ?? []).filter((t) => !idMoi.has(t.orgId))] };
}

/** Các tổ chức của lượt chạy MỚI NHẤT (đứng đầu tệp, cùng `luot`). */
export function luotMoiNhat(tt: TrangThai): readonly ToChucTrangThai[] {
  const dau = tt.toChuc[0];
  if (dau === undefined) return [];
  return dau.luot === undefined ? [dau] : tt.toChuc.filter((t) => t.luot === dau.luot);
}

/** `null` khi chưa có tệp; ném khi tệp có mà hỏng — không bao giờ lặng lẽ coi một tệp hỏng là trống. */
export async function docTrangThaiNeuCo(thuMuc: string): Promise<TrangThai | null> {
  let tho: unknown;
  try {
    tho = JSON.parse(await readFile(tepTrangThai(thuMuc), "utf8")) as unknown;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw new Error(`${tepTrangThai(thuMuc)} không đọc được — sửa hay xoá nó trước khi chạy`);
  }
  if (tho === null || typeof tho !== "object" || (tho as { phienBan?: unknown }).phienBan !== 1 || !Array.isArray((tho as { toChuc?: unknown }).toChuc)) {
    throw new Error(`${tepTrangThai(thuMuc)} không đúng hình dạng`);
  }
  return tho as TrangThai;
}

export async function docTrangThai(thuMuc: string): Promise<TrangThai> {
  const tt = await docTrangThaiNeuCo(thuMuc);
  if (tt === null) throw new Error(`chưa có ${tepTrangThai(thuMuc)} — chạy \`pnpm pilot:gia-lap\` trước`);
  return tt;
}
