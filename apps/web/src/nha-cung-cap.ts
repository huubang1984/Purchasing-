// ==============================================================================================
// [S1.9101 / S3.3e1] MÀN XÁC MINH NHÀ CUNG CẤP — PHÉP TÍNH CỦA `/nha-cung-cap`
//
// Spec S3 §9 (S3.3a/S3.3e), K8a: người giữ `supplier.qualify` (mặc định FINANCE), không giữ `rfq.invite` và không dựng hồ sơ hay
// người liên hệ nào của nhà cung cấp, xác nhận MST, tên pháp lý và đích liên lạc. Chủ dự án chốt 2026-10-06: màn riêng cho FINANCE;
// màn hiện MỌI người liên hệ — ai thêm, lúc nào — và lần xác minh gửi băm hồ sơ đã thấy (lượt soi CAO-2): một người liên hệ lạ thêm
// vào hồ sơ thật làm link mời đi tới người khác, và người xác minh phải thấy nó trước khi bấm.
//
// Phép tính THUẦN trên dữ liệu máy chủ trả về — `tsc` gác, `nha-cung-cap.test.ts` đo, phục vụ cho trình duyệt ở
// `/lib/nha-cung-cap.js` (khuôn `nhom-hang.ts`). Không luật nào ở đây là chốt: trigger `ncc_kiem_xac_minh` (`082`) và hàm gói phán.
// ==============================================================================================

/** Một người liên hệ như `GET /supplier-verifications` trả. */
export interface NguoiLienHeMan {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly themBoiTen: string | null;
}

/** Một hồ sơ trên màn — chỉ các trường màn đọc. */
export interface HoSoMan {
  readonly supplierId: string;
  readonly legalName: string;
  readonly taxCode: string | null;
  readonly status: string;
  readonly loai: "VERIFIED" | "REVOKED" | null;
  readonly conHieuLuc: boolean;
  readonly hetHanAt: string | null;
  readonly luc: string | null;
  readonly boiTen: string | null;
  readonly lyDo: string | null;
  readonly bamHoSo: string;
  readonly doiSauXacMinh: boolean;
  readonly contacts: readonly NguoiLienHeMan[];
}

const chuoi = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Đọc thân `GET /supplier-verifications`. Phần tử sai hình dạng bị bỏ — màn không vẽ thứ nó không hiểu, và không xác minh nó. */
export function docHoSo(body: unknown): HoSoMan[] {
  const ds = (body as { hoSo?: unknown } | null)?.hoSo;
  if (!Array.isArray(ds)) return [];
  const ra: HoSoMan[] = [];
  for (const x of ds as unknown[]) {
    const h = x as Record<string, unknown> | null;
    if (h === null || typeof h !== "object") continue;
    const xm = h.xacMinh as Record<string, unknown> | null | undefined;
    if (typeof h.supplierId !== "string" || typeof h.legalName !== "string" || typeof h.status !== "string") continue;
    if (typeof h.bamHoSo !== "string" || !/^[0-9a-f]{64}$/u.test(h.bamHoSo) || xm === null || typeof xm !== "object") continue;
    if (!Array.isArray(h.contacts)) continue;
    const contacts: NguoiLienHeMan[] = [];
    for (const y of h.contacts as unknown[]) {
      const c = y as Record<string, unknown> | null;
      if (c === null || typeof c !== "object" || typeof c.id !== "string" || typeof c.email !== "string") continue;
      contacts.push({
        id: c.id,
        fullName: chuoi(c.fullName) ?? "—",
        email: c.email,
        phone: chuoi(c.phone),
        status: chuoi(c.status) ?? "—",
        createdAt: chuoi(c.createdAt) ?? "",
        themBoiTen: chuoi(c.themBoiTen),
      });
    }
    ra.push({
      supplierId: h.supplierId,
      legalName: h.legalName,
      taxCode: chuoi(h.taxCode),
      status: h.status,
      loai: xm.loai === "VERIFIED" || xm.loai === "REVOKED" ? xm.loai : null,
      conHieuLuc: xm.conHieuLuc === true,
      hetHanAt: chuoi(xm.hetHanAt),
      luc: chuoi(xm.luc),
      boiTen: chuoi(h.boiTen),
      lyDo: chuoi(xm.lyDo),
      bamHoSo: h.bamHoSo,
      doiSauXacMinh: h.doiSauXacMinh === true,
      contacts,
    });
  }
  return ra;
}

const ngay = (iso: string | null): string => (iso === null || iso === "" ? "—" : new Date(iso).toLocaleDateString("vi-VN"));

/** Trạng thái xác minh nói bằng lời — kể cả vì sao một xác minh thôi hiệu lực (hồ sơ đổi, hết hạn, thu hồi). */
export function nhanXacMinh(h: HoSoMan): string {
  if (h.conHieuLuc) return `Đã xác minh, còn hiệu lực tới ${ngay(h.hetHanAt)}${h.boiTen === null ? "" : ` — ${h.boiTen}`}.`;
  if (h.loai === "VERIFIED" && h.doiSauXacMinh) {
    return "Hết hiệu lực: hồ sơ đã đổi sau lần xác minh (tên, mã số thuế, trạng thái hay một người liên hệ). Xem lại người liên hệ rồi " +
      "xác minh lại.";
  }
  if (h.loai === "VERIFIED") return `Hết hạn từ ${ngay(h.hetHanAt)} — xác minh lại để gia hạn.`;
  if (h.loai === "REVOKED") return `Đã thu hồi${h.lyDo === null ? "" : `: ${h.lyDo}`}.`;
  return "Chưa xác minh.";
}

/**
 * Người liên hệ thêm SAU lần xác minh gần nhất — thứ người xác minh phải nhìn kỹ nhất: một người liên hệ lạ trên hồ sơ thật là đường
 * link mời đi tới người khác. Không có lần xác minh nào ⇒ không người liên hệ nào bị đánh dấu.
 */
export function themSauXacMinh(h: HoSoMan, c: NguoiLienHeMan): boolean {
  if (h.luc === null || c.createdAt === "") return false;
  return new Date(c.createdAt).getTime() > new Date(h.luc).getTime();
}

/** Một người liên hệ, một dòng: tên, email, điện thoại, trạng thái, ai thêm và lúc nào. */
export function dongNguoiLienHe(h: HoSoMan, c: NguoiLienHeMan): string {
  const dt = c.phone === null || c.phone === "" ? "không số điện thoại" : c.phone;
  const ai = c.themBoiTen === null ? "không rõ người thêm" : `thêm bởi ${c.themBoiTen}`;
  const trangThai = c.status === "ACTIVE" ? "" : ` · ${c.status}`;
  const canh = themSauXacMinh(h, c) ? " · ⚠ thêm SAU lần xác minh gần nhất" : "";
  return `${c.fullName} — ${c.email}, ${dt}${trangThai} · ${ai}, ${ngay(c.createdAt)}${canh}`;
}

/** Nút nào hiện trên một hồ sơ. Máy chủ vẫn phán (quyền, luật người, tổ chức đã bật); màn chỉ giấu nút chắc chắn bị từ chối. */
export function nutHoSo(h: HoSoMan): { readonly xacMinh: boolean; readonly thuHoi: boolean } {
  const conDung = h.status === "ACTIVE" && h.taxCode !== null && h.taxCode !== "";
  return { xacMinh: conDung, thuHoi: h.loai === "VERIFIED" };
}

/** Lý do thu hồi: bắt buộc, trần 2000 byte UTF-8 (CHECK của `082`); `null` là hợp lệ. */
export function loiLyDoThuHoi(lyDo: string): string | null {
  const l = lyDo.trim();
  if (l === "") return "Cần lý do thu hồi — lý do vào sổ kiểm toán và người trong tổ chức đọc được.";
  if (new TextEncoder().encode(l).length > 2000) return "Lý do thu hồi dài quá 2000 byte.";
  return null;
}
