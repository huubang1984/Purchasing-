// ==============================================================================================
// tools/pilot-gia-lap — TRẠNG THÁI CHO BUỔI TRÌNH DIỄN (`trang-thai.json`, 0600)
//
// Thứ người trình diễn cần mà báo cáo KHÔNG được mang: bí mật TOTP của mỗi người mua giả lập (để lệnh
// `dang-nhap` in mã hiện tại), và token của những lời mời để lại cho nhà cung cấp nộp trực tiếp. Tệp
// nằm trong thư mục trạng thái 0700, cạnh `cum.json`, và `.gitignore` chặn cả thư mục.
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

export async function docTrangThai(thuMuc: string): Promise<TrangThai> {
  let tho: unknown;
  try {
    tho = JSON.parse(await readFile(tepTrangThai(thuMuc), "utf8")) as unknown;
  } catch {
    throw new Error(`chưa có ${tepTrangThai(thuMuc)} — chạy \`pnpm pilot:gia-lap\` trước`);
  }
  if (tho === null || typeof tho !== "object" || (tho as { phienBan?: unknown }).phienBan !== 1) {
    throw new Error(`${tepTrangThai(thuMuc)} không đúng hình dạng`);
  }
  return tho as TrangThai;
}
