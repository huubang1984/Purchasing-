// ==============================================================================================
// tools/khoi-tao-to-chuc — BẢN KHAI: đọc và kiểm, hàm THUẦN (ADR-111)
//
// Bản khai là một đối tượng JSON do người vận hành viết cho MỘT lần chạy:
//
//   { "cheDo": "tao",
//     "toChuc": { "ten": "Công ty CP …", "slug": "cong-ty-abc" },
//     "nguoi":  [ { "email": "a@congty.vn", "hoTen": "Nguyễn Văn A", "vai": ["PROCUREMENT_MANAGER"] }, … ] }
//
//   { "cheDo": "them-nguoi",
//     "toChuc": { "id": "<uuid của tổ chức đã có>" },
//     "nguoi":  [ … ] }
//
// Nó mang email và họ tên của nhân viên khách — dữ liệu cá nhân — nên trên prod nó sống ở Secrets Manager và bị xoá sau lần
// chạy (ADR-111 mục 5). Tệp này KHÔNG in, KHÔNG ghi log, và mọi thông điệp lỗi của nó chỉ nêu VỊ TRÍ ("người thứ 3") và
// TÊN TRƯỜNG, không nêu giá trị: thông điệp lỗi của task đi thẳng vào CloudWatch Logs của tài khoản prod.
//
// Luật kiểm chặt hơn CSDL ở chỗ CSDL không nói được gì hữu ích (thiếu trường, vai lạ, trùng trong CÙNG bản khai) và KHÔNG cố
// thay CSDL ở chỗ CSDL là trọng tài: email hạ chữ bằng `pg_catalog.lower()` lúc chèn (`khoi-tao.ts`), không bằng
// `toLowerCase()` của JS — hai hàm lệch nhau trên hơn trăm điểm mã (khoản nợ 63, `packages/identity/src/login.ts`), và
// đường đăng nhập tra bằng hàm của CSDL. Tổ hợp vai trái luật (D3, `033`) do trigger phán, không do tệp này.
// ==============================================================================================

export class BanKhaiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BanKhaiError";
  }
}

/**
 * Danh mục vai của `005` (`INSERT INTO roles`). `khoi-tao.int.test.ts` đòi danh sách này khớp bảng `roles` thật.
 * **[S1.193 / S4.2a]** Cộng `DATA_STEWARD` — vai quản lý dữ liệu mù giá; trigger mức người chỉ cho nó ghép với `TECHNICAL`.
 */
export const MA_VAI = ["REQUESTER", "BUYER", "TECHNICAL", "PROCUREMENT_MANAGER", "FINANCE", "DIRECTOR", "DATA_STEWARD"] as const;
export type MaVai = (typeof MA_VAI)[number];

export type CheDo = "tao" | "them-nguoi";

export interface NguoiKhai {
  readonly email: string;
  readonly hoTen: string;
  readonly vai: readonly MaVai[];
}

export type BanKhai =
  | { readonly cheDo: "tao"; readonly ten: string; readonly slug: string; readonly nguoi: readonly NguoiKhai[] }
  | { readonly cheDo: "them-nguoi"; readonly orgId: string; readonly nguoi: readonly NguoiKhai[] };

/**
 * Trần số người mỗi lần chạy: một giao dịch, và khoá chuỗi sổ của tổ chức (`004`) bị giữ từ lần ghi sổ đầu tới COMMIT —
 * mọi lần ghi sổ khác của tổ chức ấy chờ, tối đa 2 s (`050`) rồi hỏng 55P03. ~~200~~ **[lượt soi]** 50: người soi đo 200
 * người × 3 vai giữ khoá 3,7 s trên máy cục bộ. Không phải một bộ nhập hàng loạt — tổ chức lớn thì chạy nhiều lần.
 */
export const TRAN_SO_NGUOI = 50;
const TRAN_TEN = 200;
// [S1.183] Hai mẫu dưới được xuất cho `docThamSo` (`index.ts`), và `deploy/trien-khai.sh` (`kiem_dau_vao`) mang cùng hai mẫu
// ấy bằng bash — `tests/deploy/khoi-tao-sh.test.ts` so hai phía trên cùng một bộ đầu vào.
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// Slug là định danh trong URL, duy nhất TOÀN CỤC (002): chữ thường không dấu, số, gạch nối ở giữa; 3–63 ký tự.
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
// Cùng hình dạng bộ gửi SES dùng (`apps/api/src/adapters/gui-ses.ts`): một địa chỉ đơn, không khoảng trắng, không dấu phẩy.
// [lượt soi] Và không ký tự điều khiển hay định dạng (`\p{C}`: `\u0001`, zero-width, đảo chiều): `/auth/link` từ chối một email
// mang chúng, nên người ấy không bao giờ xin được link đăng nhập.
const EMAIL = /^[^\s@,;<>"\p{C}]{1,64}@[^\s@,;<>"\p{C}]{1,253}\.[^\s@,;<>"\p{C}]{2,63}$/u;
const TRAN_EMAIL = 320;

function laDoiTuong(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function chuoi(o: Record<string, unknown>, ten: string, noi: string): string {
  const v = o[ten];
  if (typeof v !== "string" || v.trim() === "") throw new BanKhaiError(`${noi}: thiếu trường "${ten}" (chuỗi khác rỗng)`);
  return v.trim();
}

function chiCoKhoa(o: Record<string, unknown>, duoc: readonly string[], noi: string): void {
  for (const k of Object.keys(o)) {
    // [lượt soi] Tên khoá lạ chỉ được in khi nó TRÔNG như một tên trường: một email hay họ tên gõ nhầm vào chỗ khoá (hay một
    // khoá mang xuống dòng giả làm dòng log) không được đi ra CloudWatch Logs.
    const ten = /^[A-Za-z][A-Za-z0-9_]{0,31}$/u.test(k) ? `"${k}"` : "(tên không in được)";
    if (!duoc.includes(k)) throw new BanKhaiError(`${noi}: trường lạ ${ten} — bản khai chỉ nhận ${duoc.join(", ")}`);
  }
}

function docNguoi(x: unknown, i: number): NguoiKhai {
  const noi = `người thứ ${String(i + 1)}`;
  if (!laDoiTuong(x)) throw new BanKhaiError(`${noi}: phải là một đối tượng`);
  chiCoKhoa(x, ["email", "hoTen", "vai"], noi);
  const email = chuoi(x, "email", noi);
  if (email.length > TRAN_EMAIL || !EMAIL.test(email)) throw new BanKhaiError(`${noi}: "email" không phải một địa chỉ email đơn hợp lệ`);
  const hoTen = chuoi(x, "hoTen", noi);
  if (hoTen.length > TRAN_TEN) throw new BanKhaiError(`${noi}: "hoTen" dài quá ${String(TRAN_TEN)} ký tự`);
  const vai = x["vai"];
  if (!Array.isArray(vai) || vai.length === 0) throw new BanKhaiError(`${noi}: "vai" phải là mảng khác rỗng`);
  const daCo = new Set<string>();
  for (const v of vai) {
    if (typeof v !== "string" || !(MA_VAI as readonly string[]).includes(v)) {
      throw new BanKhaiError(`${noi}: vai lạ — chỉ nhận ${MA_VAI.join(", ")}`);
    }
    if (daCo.has(v)) throw new BanKhaiError(`${noi}: vai ${v} khai hai lần`);
    daCo.add(v);
  }
  return { email, hoTen, vai: vai as MaVai[] };
}

/**
 * Đọc bản khai từ chuỗi JSON. `cheDo` phải trùng lệnh người vận hành gõ (`tao` / `them-nguoi`) — hai lời khai của cùng một ý
 * định: bản khai tạo tổ chức chạy nhầm ở lệnh thêm người (hay ngược lại) là dừng, không đoán.
 */
export function docBanKhai(json: string, lenh: CheDo): BanKhai {
  let tho: unknown;
  try {
    // [S1.183] Bỏ MỘT dấu BOM ở đầu: Notepad và PowerShell 5 ghi UTF-8 kèm BOM, và `JSON.parse` từ chối nó. Băm SHA-256 mà người
    // duyệt duyệt tính trên nội dung GỐC (`index.ts`), nên bỏ BOM ở đây không làm lệch băm.
    tho = JSON.parse(json.startsWith("\uFEFF") ? json.slice(1) : json) as unknown;
  } catch {
    throw new BanKhaiError("bản khai không phải JSON hợp lệ");
  }
  if (!laDoiTuong(tho)) throw new BanKhaiError("bản khai phải là một đối tượng JSON");
  chiCoKhoa(tho, ["cheDo", "toChuc", "nguoi"], "bản khai");
  const cheDo = tho["cheDo"];
  if (cheDo !== "tao" && cheDo !== "them-nguoi") throw new BanKhaiError('bản khai: "cheDo" phải là "tao" hoặc "them-nguoi"');
  if (cheDo !== lenh) throw new BanKhaiError(`bản khai có "cheDo": "${cheDo}" nhưng lệnh là "${lenh}" — dừng, không đoán`);

  const toChuc = tho["toChuc"];
  if (!laDoiTuong(toChuc)) throw new BanKhaiError('bản khai: thiếu "toChuc" (đối tượng)');

  const ds = tho["nguoi"];
  if (!Array.isArray(ds) || ds.length === 0) throw new BanKhaiError('bản khai: "nguoi" phải là mảng khác rỗng');
  if (ds.length > TRAN_SO_NGUOI) throw new BanKhaiError(`bản khai: quá ${String(TRAN_SO_NGUOI)} người trong một lần chạy`);
  const nguoi = ds.map(docNguoi);
  // Trùng email trong CÙNG bản khai: ~~so theo chữ thường ASCII~~ **[lượt soi]** so theo `toLowerCase()` của JS — bắt cả
  // `ĐẠI@…` cạnh `đại@…`, ca mà bản ASCII để rơi xuống CSDL với thông điệp sai "email đã có trong tổ chức". CSDL vẫn là
  // trọng tài: vài điểm mã JS và `pg_catalog.lower()` hạ khác nhau thì rơi vào `UNIQUE (org_id, email)` và rollback trọn.
  const thay = new Map<string, number>();
  nguoi.forEach((n, i) => {
    const k = n.email.toLowerCase();
    const truoc = thay.get(k);
    if (truoc !== undefined) throw new BanKhaiError(`người thứ ${String(i + 1)}: trùng email với người thứ ${String(truoc + 1)}`);
    thay.set(k, i);
  });

  if (cheDo === "tao") {
    chiCoKhoa(toChuc, ["ten", "slug"], "toChuc");
    const ten = chuoi(toChuc, "ten", "toChuc");
    if (ten.length > TRAN_TEN) throw new BanKhaiError(`toChuc: "ten" dài quá ${String(TRAN_TEN)} ký tự`);
    const slug = chuoi(toChuc, "slug", "toChuc");
    if (!SLUG.test(slug)) throw new BanKhaiError('toChuc: "slug" chỉ gồm a-z, 0-9 và gạch nối ở giữa, 3–63 ký tự');
    return { cheDo, ten, slug, nguoi };
  }
  chiCoKhoa(toChuc, ["id"], "toChuc");
  const orgId = chuoi(toChuc, "id", "toChuc");
  if (!UUID_V4.test(orgId)) throw new BanKhaiError('toChuc: "id" phải là UUIDv4 chữ thường');
  return { cheDo, orgId, nguoi };
}

/**
 * [S1.183 / ADR-111] Điều người duyệt THẤY trước khi bấm duyệt (bảng của job `build` trong `.github/workflows/khoi-tao.yml`):
 * tổ chức (slug khi tạo, mã khi thêm người), số người, và số người mang TỪNG mã vai (`vaiTheoMa`). Người duyệt không đọc được bản
 * khai — nó mang email và họ tên —, nên thứ họ duyệt là bộ này cộng tên, phiên bản và băm SHA-256 của bí mật (`index.ts`).
 * ~~tổng số cặp người–vai~~ **[lượt soi]** số theo từng mã vai: cùng tổng mà đổi `REQUESTER` thành `DIRECTOR` thì tổng không lệch.
 */
export interface KyVong {
  readonly toChuc: string;
  readonly soNguoi: number;
  /** Dạng chuẩn `MA=n,MA=n` theo thứ tự `MA_VAI`, chỉ mã có người — `vaiTheoMa` dựng đúng dạng ấy từ bản khai. */
  readonly vai: string;
}

/** Số người mang từng mã vai, dạng chuẩn `MA=n` nối bằng dấu phẩy, theo thứ tự `MA_VAI`, bỏ mã không ai mang. */
export function vaiTheoMa(bk: BanKhai): string {
  return MA_VAI.map((ma) => [ma, bk.nguoi.filter((n) => n.vai.includes(ma)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([ma, n]) => `${ma}=${String(n)}`)
    .join(",");
}

/**
 * Bản khai ở đúng phiên bản đã đọc phải khớp điều đã duyệt — kiểm TRƯỚC khi mở CSDL. Lệch ⇒ `BanKhaiError` nêu từng trường
 * lệch với hai giá trị: slug, mã tổ chức, số người và số theo mã vai không phải dữ liệu cá nhân (mã tổ chức không bí mật, ADR-107).
 */
export function kiemKhop(bk: BanKhai, kv: KyVong): void {
  const lech: string[] = [];
  const toChuc = bk.cheDo === "tao" ? bk.slug : bk.orgId;
  if (toChuc !== kv.toChuc) lech.push(`tổ chức: bản khai "${toChuc}", đã duyệt "${kv.toChuc}"`);
  if (bk.nguoi.length !== kv.soNguoi) lech.push(`số người: bản khai ${String(bk.nguoi.length)}, đã duyệt ${String(kv.soNguoi)}`);
  const vai = vaiTheoMa(bk);
  if (vai !== kv.vai) lech.push(`vai: bản khai "${vai}", đã duyệt "${kv.vai}"`);
  if (lech.length > 0) throw new BanKhaiError(`bản khai không khớp điều đã duyệt — ${lech.join("; ")}`);
}
