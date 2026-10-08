// ==============================================================================================
// [S1.283 / S3.4b] KHỐI KHAI BÁO XUNG ĐỘT LỢI ÍCH — MỘT KHỐI, HAI TRANG (`/tao-thau`, `/mo-thau`)
//
// Spec S3 §4.5, §5.1 K9, §8.7; ADR-155. K9 (S3.4a, `114`) chặn người sắp ký duyệt gói, ghi nhận tín hiệu (`/tao-thau`), chấm, đề xuất,
// duyệt hay huỷ trao thầu (`/mo-thau`) khi họ chưa khai *không xung đột* với danh sách mời HIỆN TẠI — ở bậc đòi khai —, hay đã khai
// CÓ xung đột trên gói (mọi bậc, vĩnh viễn). Trước vòng này không màn nào khai được: người đi trên màn của tổ chức demo bị chặn ở nút
// ký (ADR-155 ⑻). Khối này nói TRƯỚC — trạng thái khai báo của chính người xem, đọc từ cùng hàm vị từ mà bảy cổng hỏi — và cho khai.
//
// Hai trang gắn CÙNG module với CÙNG bộ id (khuôn `dang-nhap.ts`): module chạm DOM qua `document` mà trang trao vào, không qua tên
// toàn cục, và không sink HTML nào (`textContent`, `createElement`). Không luật nào ở đây là chốt: trigger `coi_kiem_khai_bao` và
// bảy trigger cổng phán; khối chỉ đọc lời của máy chủ và gửi lời khai.
//
// DANH SÁCH NHÀ CUNG CẤP — vì sao trang trao vào, không route này trả: khai *không xung đột* là khai về một danh sách, nên người khai
// phải THẤY danh sách. Nhưng danh sách mời của một gói chỉ đọc được qua `rfq.invite` (`listInvitations`), và sau mở thầu qua bảng so
// sánh (`bid.view`). Route khai báo trả tên nhà cung cấp cho mọi người giữ `coi.declare` là MỞ RỘNG quyền đọc danh sách mời tới người
// yêu cầu mua và kỹ thuật — trước khi đóng thầu, *"ai đang dự gói này"* là thứ một người trong nhà mang ra ngoài được. Nên khối lấy
// danh sách từ thứ trang ĐÃ được phép đọc (`/tao-thau`: bảng lời mời; `/mo-thau`: bảng so sánh), và nói thẳng khi không có.
// ==============================================================================================

/** Một lời khai như `GET /rfqs/:rfqId/coi-declarations` trả (`khaiBao.khaiBao[]`). */
export interface KhaiBaoMan {
  readonly trangThai: string;
  readonly supplierId: string | null;
  readonly ghiChu: string | null;
  readonly danhSachBam: string;
  readonly luc: string;
}

/** Thân `khaiBao` của `GET /rfqs/:rfqId/coi-declarations` — khai báo của CHÍNH người xem và chốt K9 đang nói gì về họ. */
export interface KhaiBaoCuaToiMan {
  readonly khaiBao: readonly KhaiBaoMan[];
  readonly danhSachBamHienTai: string;
  readonly bacDoiKhai: boolean;
  readonly chot: string | null;
  readonly toChucDaBat: boolean;
}

/** Một nhà cung cấp chọn được ở ô *có xung đột với* — từ thứ trang đã đọc được. `conSong`: còn một lời mời chưa thu hồi. */
export interface NhaCungCapKhai {
  readonly supplierId: string;
  readonly ten: string;
  readonly conSong: boolean;
}

/** Trạng thái của người xem với gói, theo lời của máy chủ. */
export type LoaiKhai = "AN" | "QUA" | "KHONG_DOI" | "CAN_KHAI" | "LOI_THOI" | "CO_XUNG_DOT";

/** Thứ khối vẽ — một hàm thuần của lời đọc. */
export interface KhungKhaiBao {
  readonly loai: LoaiKhai;
  readonly tomTat: string;
  readonly lichSu: readonly string[];
  /** Nút *không xung đột* hiện. */
  readonly choKhaiKhong: boolean;
}

/** Trần ghi chú — CHECK `coi_declarations_ghi_chu_check` (`114`), đo bằng byte UTF-8 sau khi cắt. */
export const TRAN_GHI_CHU_BYTE = 2000;

/** Bộ id mà module gắn vào — hai tệp HTML khai ĐỦ, mỗi id đúng một lần (`xung-dot.test.ts`). */
export const ID_KHAI_BAO = [
  "khoi-khai-bao",
  "kb-tom-tat",
  "kb-lich-su",
  "kb-ghi-chu",
  "nut-kb-khong",
  "kb-co",
  "kb-ncc",
  "kb-xac-nhan",
  "nut-kb-co",
  "kb-khong-ds",
  "kb-loi",
  "kb-ok",
] as const;

/** Phần tử ẩn lúc tải — khối chỉ hiện sau lần đọc đầu của một tổ chức đã bật. */
export const ID_AN_KHAI_BAO = ["khoi-khai-bao", "nut-kb-khong", "kb-co", "kb-khong-ds", "kb-loi", "kb-ok"] as const;

const chuoiKb = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** Đọc thân `GET /rfqs/:rfqId/coi-declarations` (cả `{ khaiBao: … }`); hình dạng lạ ⇒ `null`. */
export function docKhaiBaoCuaToi(than: unknown): KhaiBaoCuaToiMan | null {
  if (than === null || typeof than !== "object") return null;
  const kb = (than as { khaiBao?: unknown }).khaiBao;
  if (kb === null || typeof kb !== "object") return null;
  const k = kb as Record<string, unknown>;
  if (!Array.isArray(k.khaiBao) || typeof k.bacDoiKhai !== "boolean" || typeof k.toChucDaBat !== "boolean") return null;
  const ds: KhaiBaoMan[] = [];
  for (const h of k.khaiBao as unknown[]) {
    if (h === null || typeof h !== "object") return null;
    const x = h as Record<string, unknown>;
    const trangThai = chuoiKb(x.trangThai);
    if (trangThai === null) return null;
    ds.push({
      trangThai,
      supplierId: chuoiKb(x.supplierId),
      ghiChu: chuoiKb(x.ghiChu),
      danhSachBam: chuoiKb(x.danhSachBam) ?? "",
      luc: chuoiKb(x.luc) ?? "",
    });
  }
  return {
    khaiBao: ds,
    danhSachBamHienTai: chuoiKb(k.danhSachBamHienTai) ?? "",
    bacDoiKhai: k.bacDoiKhai,
    chot: chuoiKb(k.chot),
    toChucDaBat: k.toChucDaBat,
  };
}

/** Giờ theo trình duyệt của người đọc, không phải chuỗi ISO. */
function gio(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN");
}

/**
 * Khung của khối từ lời đọc. `tenNcc` giải tên nhà cung cấp từ danh sách trang đang có (không có ⇒ «một nhà cung cấp»). Thứ tự:
 * tổ chức chưa bật ⇒ ẩn; đã khai CÓ xung đột ⇒ câu ấy, mọi bậc (máy chủ trả `K9_CO_XUNG_DOT` ở mọi bậc); rồi theo chốt.
 */
export function khungKhaiBao(kb: KhaiBaoCuaToiMan | null, tenNcc: (supplierId: string) => string | null): KhungKhaiBao {
  if (kb === null || !kb.toChucDaBat) return { loai: "AN", tomTat: "", lichSu: [], choKhaiKhong: false };
  const ten = (id: string | null): string => (id === null ? null : tenNcc(id)) ?? "một nhà cung cấp của gói";
  const lichSu = kb.khaiBao.map((h) =>
    h.trangThai === "CO_XUNG_DOT"
      ? `${gio(h.luc)} — CÓ xung đột với ${ten(h.supplierId)}${h.ghiChu === null ? "" : ` («${h.ghiChu}»)`}`
      : `${gio(h.luc)} — không xung đột với danh sách mời lúc ấy (${h.danhSachBam === kb.danhSachBamHienTai ? "danh sách chưa đổi" : "danh sách đã đổi từ đó"})` +
        (h.ghiChu === null ? "" : ` («${h.ghiChu}»)`),
  );
  const co = kb.khaiBao.find((h) => h.trangThai === "CO_XUNG_DOT");
  if (co !== undefined) {
    return {
      loai: "CO_XUNG_DOT",
      tomTat:
        `Bạn đã khai CÓ xung đột lợi ích với ${ten(co.supplierId)} trên gói này (${gio(co.luc)}). Lời khai ấy là vĩnh viễn cho gói: ` +
        "bạn không ký, chấm, đề xuất, duyệt hay huỷ trao thầu, hay ghi nhận tín hiệu của gói này — việc ấy phải do người khác làm. " +
        "Chữ ký bạn đã ký trên gói thôi được đếm.",
      lichSu,
      choKhaiKhong: false,
    };
  }
  const hieuLuc = kb.khaiBao.filter((h) => h.trangThai === "KHONG_XUNG_DOT" && h.danhSachBam === kb.danhSachBamHienTai).at(-1);
  if (kb.chot === null && !kb.bacDoiKhai) {
    return {
      loai: "KHONG_DOI",
      tomTat:
        "Bậc chính sách của gói này không đòi khai báo xung đột lợi ích trước khi ký hay quyết. Có quan hệ với một nhà cung cấp " +
        "được mời thì vẫn khai «có xung đột» — lời khai ấy chặn bạn trên gói này ở mọi bậc.",
      lichSu,
      choKhaiKhong: hieuLuc === undefined,
    };
  }
  if (kb.chot === null) {
    return {
      loai: "QUA",
      tomTat:
        `Bạn đã khai không xung đột với danh sách mời hiện tại${hieuLuc === undefined ? "" : ` (${gio(hieuLuc.luc)})`}. Danh sách ` +
        "đổi — thêm hay thu hồi lời mời, lập hay rút ngoại lệ — thì lời khai ấy hết hiệu lực và bạn khai lại.",
      lichSu,
      choKhaiKhong: false,
    };
  }
  if (kb.chot === "K9_KHAI_BAO_LOI_THOI") {
    return {
      loai: "LOI_THOI",
      tomTat:
        "Lời khai «không xung đột» của bạn nói về một danh sách mời đã đổi — nó không còn hiệu lực. Xem lại danh sách nhà cung cấp " +
        "rồi khai lại trước khi ký hay quyết.",
      lichSu,
      choKhaiKhong: true,
    };
  }
  return {
    loai: "CAN_KHAI",
    tomTat:
      "Gói này ở bậc đòi khai báo: trước khi ký duyệt, chấm, đề xuất, duyệt hay huỷ trao thầu, hay ghi nhận tín hiệu, bạn khai xung " +
      "đột lợi ích với danh sách mời hiện tại. Lời khai là của bạn — có tên, thời điểm, phiên — và ở lại trong sổ.",
    lichSu,
    choKhaiKhong: true,
  };
}

/** Ghi chú hợp lệ không: rỗng (sau khi cắt) ⇒ bỏ trường; quá trần byte ⇒ câu lỗi. */
export function loiGhiChuKhai(ghiChu: string): string | null {
  const c = ghiChu.trim();
  if (new TextEncoder().encode(c).length > TRAN_GHI_CHU_BYTE) {
    return `Ghi chú dài quá ${String(TRAN_GHI_CHU_BYTE)} byte — rút gọn lại.`;
  }
  return null;
}

/** Thân `POST /rfqs/:rfqId/coi-declarations`: `supplierId` chỉ với `CO_XUNG_DOT`; ghi chú rỗng thì bỏ trường. */
export function thanKhaiBao(trangThai: "KHONG_XUNG_DOT" | "CO_XUNG_DOT", supplierId: string | null, ghiChu: string): Record<string, unknown> {
  const c = ghiChu.trim();
  return {
    trangThai,
    ...(trangThai === "CO_XUNG_DOT" && supplierId !== null ? { supplierId } : {}),
    ...(c === "" ? {} : { ghiChu: c }),
  };
}

/**
 * Một câu chỉ dẫn cho lời từ chối K9 có mã (`ma` ở thân 422). Câu của máy chủ (`CHOT_VAO_SO`) đã nói phải làm gì; câu này BỔ SUNG chỗ
 * làm việc ấy trên màn (khuôn `chiDanChot` của `tao-thau.ts`). Mã khác ⇒ `null`.
 */
export function chiDanK9(ma: unknown): string | null {
  switch (ma) {
    case "K9_CHUA_KHAI_XUNG_DOT":
      return "Trên màn: khối «Khai báo xung đột lợi ích» của gói này — khai rồi bấm lại.";
    case "K9_KHAI_BAO_LOI_THOI":
      return "Trên màn: khối «Khai báo xung đột lợi ích» nói danh sách đã đổi — xem lại rồi khai lại.";
    case "K9_CO_XUNG_DOT":
      return "Nhờ một người giữ cùng quyền mà không có quan hệ với nhà cung cấp nào của gói làm việc này.";
    case "K9_CHU_KY_CO_XUNG_DOT":
      return "Nhờ thêm một người duyệt khác — đã khai không xung đột — ký, rồi bấm lại.";
    default:
      return null;
  }
}

/** Nhà cung cấp từ `GET /rfqs/:rfqId/invitations` (`invitations[]`): mỗi nhà cung cấp một dòng, còn sống nếu còn một lời mời chưa thu hồi. */
export function nhaCungCapTuLoiMoi(ds: unknown): NhaCungCapKhai[] {
  if (!Array.isArray(ds)) return [];
  const theoId = new Map<string, NhaCungCapKhai>();
  for (const m of ds as unknown[]) {
    if (m === null || typeof m !== "object") continue;
    const x = m as Record<string, unknown>;
    const id = chuoiKb(x.supplierId);
    if (id === null) continue;
    const conSong = x.revokedAt === null || x.revokedAt === undefined;
    const truoc = theoId.get(id);
    theoId.set(id, { supplierId: id, ten: chuoiKb(x.supplierName) ?? truoc?.ten ?? id, conSong: conSong || (truoc?.conSong ?? false) });
  }
  return [...theoId.values()];
}

/** Nhà cung cấp từ `GET /rfqs/:rfqId/comparison` (`comparison.rows[]`) — mỗi nhà cung cấp một dòng (bảng có thể nhiều dòng BAFO). */
export function nhaCungCapTuSoSanh(rows: unknown): NhaCungCapKhai[] {
  if (!Array.isArray(rows)) return [];
  const theoId = new Map<string, NhaCungCapKhai>();
  for (const h of rows as unknown[]) {
    if (h === null || typeof h !== "object") continue;
    const x = h as Record<string, unknown>;
    const id = chuoiKb(x.supplierId);
    if (id === null || theoId.has(id)) continue;
    theoId.set(id, { supplierId: id, ten: chuoiKb(x.supplierLegalName) ?? id, conSong: true });
  }
  return [...theoId.values()];
}

/**
 * [lượt đi thử T4] Nhà cung cấp từ `GET /rfqs/:rfqId/ranking` (`ranking.rows[]`, mang `supplierId` từ S3.4b). Ở `AWARDED` bảng so sánh
 * đã đóng — đúng lúc người duyệt trao thầu ký —, còn bảng xếp hạng thì đọc được.
 */
export function nhaCungCapTuXepHang(rows: unknown): NhaCungCapKhai[] {
  if (!Array.isArray(rows)) return [];
  const theoId = new Map<string, NhaCungCapKhai>();
  for (const h of rows as unknown[]) {
    if (h === null || typeof h !== "object") continue;
    const x = h as Record<string, unknown>;
    const id = chuoiKb(x.supplierId);
    if (id === null || theoId.has(id)) continue;
    theoId.set(id, { supplierId: id, ten: chuoiKb(x.supplierName) ?? id, conSong: true });
  }
  return [...theoId.values()];
}

/** Gộp nhiều danh sách, mỗi nhà cung cấp một lần — còn sống nếu một nguồn nói còn sống. */
export function gopNhaCungCap(...ds: readonly (readonly NhaCungCapKhai[])[]): NhaCungCapKhai[] {
  const theoId = new Map<string, NhaCungCapKhai>();
  for (const n of ds.flat()) {
    const truoc = theoId.get(n.supplierId);
    theoId.set(n.supplierId, truoc === undefined ? n : { ...truoc, conSong: truoc.conSong || n.conSong });
  }
  return [...theoId.values()];
}

// ---------------------------------------------------------------------------------------------
// Gắn vào DOM của trang
// ---------------------------------------------------------------------------------------------

/** Phần tử mà module chạm — tập con của `HTMLElement`, đủ cho DOM giả của test. */
export interface PhanTuKhaiBao {
  hidden: boolean;
  textContent: string | null;
  value: string;
  disabled: boolean;
  checked: boolean;
  addEventListener(loai: string, nghe: () => unknown): void;
  replaceChildren(): void;
  append(...con: PhanTuKhaiBao[]): void;
}

export interface TuyChonKhaiBao {
  /** `document` của trang. */
  readonly taiLieu: {
    getElementById(id: string): PhanTuKhaiBao | null;
    createElement(ten: string): PhanTuKhaiBao;
  };
  /** `goi` của trang: `fetch` tới `/api`, cùng origin; NÉM khi mất mạng. */
  readonly goi: (method: string, duong: string, than?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;
  /** Câu lỗi của trang cho một phản hồi hỏng (thân 403 hằng, `error` của máy chủ). */
  readonly loiCua: (r: { readonly status: number; readonly body: unknown }, macDinh: string) => string;
  /** Gói đang mở trên màn — rỗng khi chưa có. */
  readonly rfqId: () => string;
  /** Nhà cung cấp trang đang có quyền thấy (bảng lời mời, bảng so sánh) — rỗng khi chưa đọc. */
  readonly nhaCungCap: () => readonly NhaCungCapKhai[];
  /** Câu nói lối lấy danh sách khi trang chưa có — mỗi trang một câu. */
  readonly khiKhongCoDanhSach: string;
}

export interface KhoiKhaiBao {
  /** Đọc khai báo của người xem trên gói đang mở và vẽ. Tổ chức chưa bật, hay chưa có gói ⇒ khối ẩn. Câu trả của gói trước tới muộn ⇒ bỏ. */
  nap(): Promise<void>;
  /** Khối ẩn và rỗng — trang gọi khi đổi người, đổi gói, hay người xem không giữ `coi.declare`. */
  an(): void;
  /** Vẽ lại ô nhà cung cấp từ danh sách trang vừa đọc, không gọi máy chủ. */
  veNhaCungCap(): void;
}

export function ganKhaiBao(tc: TuyChonKhaiBao): KhoiKhaiBao {
  const $ = (id: (typeof ID_KHAI_BAO)[number]): PhanTuKhaiBao => {
    const e = tc.taiLieu.getElementById(id);
    if (e === null) throw new Error(`xung-dot: trang thiếu phần tử #${id}`);
    return e;
  };
  for (const id of ID_KHAI_BAO) $(id);
  const hien = (e: PhanTuKhaiBao, co: boolean): void => {
    e.hidden = !co;
  };
  const bao = (e: PhanTuKhaiBao, chu: string): void => {
    e.textContent = chu;
    hien(e, chu !== "");
  };
  // Lượt đọc: tăng mỗi lần `nap`/`an` — câu trả của lượt đã qua (gói trước, người trước) bị bỏ khi về.
  let luot = 0;
  let khung: KhungKhaiBao = { loai: "AN", tomTat: "", lichSu: [], choKhaiKhong: false };

  const tenNcc = (id: string): string | null => tc.nhaCungCap().find((n) => n.supplierId === id)?.ten ?? null;

  function veNhaCungCap(): void {
    const ds = tc.nhaCungCap();
    const o = $("kb-ncc");
    o.replaceChildren();
    for (const n of [...ds].sort((a, b) => Number(b.conSong) - Number(a.conSong))) {
      const op = tc.taiLieu.createElement("option");
      op.value = n.supplierId;
      op.textContent = n.conSong ? n.ten : `${n.ten} (lời mời đã thu hồi)`;
      o.append(op);
    }
    const co = khung.loai !== "AN";
    hien($("kb-co"), co && ds.length > 0);
    bao($("kb-khong-ds"), co && ds.length === 0 ? tc.khiKhongCoDanhSach : "");
  }

  function ve(k: KhungKhaiBao): void {
    khung = k;
    hien($("khoi-khai-bao"), k.loai !== "AN");
    $("kb-tom-tat").textContent = k.tomTat;
    const ls = $("kb-lich-su");
    ls.replaceChildren();
    for (const d of k.lichSu) {
      const li = tc.taiLieu.createElement("li");
      li.textContent = d;
      ls.append(li);
    }
    hien($("nut-kb-khong"), k.choKhaiKhong);
    $("kb-xac-nhan").checked = false;
    veNhaCungCap();
  }

  function an(): void {
    luot += 1;
    ve({ loai: "AN", tomTat: "", lichSu: [], choKhaiKhong: false });
    bao($("kb-loi"), "");
    bao($("kb-ok"), "");
    $("kb-ghi-chu").value = "";
  }

  async function nap(): Promise<void> {
    const id = tc.rfqId();
    luot += 1;
    const cua = luot;
    if (id === "") {
      an();
      return;
    }
    let r: { readonly status: number; readonly body: unknown };
    try {
      r = await tc.goi("GET", `/rfqs/${id}/coi-declarations`);
    } catch {
      if (cua === luot) bao($("kb-loi"), "Không đọc được khai báo xung đột lợi ích — mất kết nối tới máy chủ. Đọc lại gói sau ít phút.");
      return;
    }
    if (cua !== luot || tc.rfqId() !== id) return;
    if (r.status !== 200) {
      ve({ loai: "AN", tomTat: "", lichSu: [], choKhaiKhong: false });
      bao($("kb-loi"), tc.loiCua(r, "Không đọc được khai báo xung đột lợi ích"));
      return;
    }
    ve(khungKhaiBao(docKhaiBaoCuaToi(r.body), tenNcc));
  }

  async function guiKhai(trangThai: "KHONG_XUNG_DOT" | "CO_XUNG_DOT", nut: PhanTuKhaiBao): Promise<void> {
    bao($("kb-loi"), "");
    bao($("kb-ok"), "");
    const id = tc.rfqId();
    if (id === "") {
      bao($("kb-loi"), "Đọc một gói thầu trước.");
      return;
    }
    const ghiChu = $("kb-ghi-chu").value;
    const sai = loiGhiChuKhai(ghiChu);
    if (sai !== null) {
      bao($("kb-loi"), sai);
      return;
    }
    let supplierId: string | null = null;
    if (trangThai === "CO_XUNG_DOT") {
      supplierId = $("kb-ncc").value;
      if (supplierId === "") {
        bao($("kb-loi"), "Chọn nhà cung cấp bạn có quan hệ.");
        return;
      }
      if (!$("kb-xac-nhan").checked) {
        bao($("kb-loi"), "Đánh dấu ô xác nhận: lời khai có xung đột là vĩnh viễn cho gói này, không khai lại được.");
        return;
      }
    }
    nut.disabled = true;
    try {
      const r = await tc.goi("POST", `/rfqs/${id}/coi-declarations`, thanKhaiBao(trangThai, supplierId, ghiChu));
      if (tc.rfqId() !== id) return;
      if (r.status !== 201) {
        bao($("kb-loi"), tc.loiCua(r, "Không khai được"));
        await nap();
        return;
      }
      $("kb-ghi-chu").value = "";
      await nap();
      bao(
        $("kb-ok"),
        trangThai === "KHONG_XUNG_DOT"
          ? "Đã khai không xung đột với danh sách mời hiện tại. Bấm lại bước bạn định làm."
          : `Đã khai có xung đột với ${tenNcc(supplierId ?? "") ?? "nhà cung cấp đã chọn"}. Từ giờ người khác làm các bước quyết của gói này.`,
      );
    } catch {
      bao($("kb-loi"), "Không gửi được lời khai — mất kết nối tới máy chủ. Kiểm tra mạng rồi bấm lại.");
    } finally {
      nut.disabled = false;
    }
  }

  $("nut-kb-khong").addEventListener("click", () => guiKhai("KHONG_XUNG_DOT", $("nut-kb-khong")));
  $("nut-kb-co").addEventListener("click", () => guiKhai("CO_XUNG_DOT", $("nut-kb-co")));

  return { nap, an, veNhaCungCap };
}
