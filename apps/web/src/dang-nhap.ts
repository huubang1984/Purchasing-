// ==============================================================================================
// [S1.240 / khoản 282] BƯỚC 1 CỦA ~~BỐN~~ [S1.249 / khoản 291] NĂM TRANG NGƯỜI MUA — MỘT BẢN, MỘT PHÉP ĐO
//
// [S1.249 / khoản 291] Trang thứ năm: `/du-lieu` (S4.2b, người quản lý dữ liệu) từng chép nút Vào cũ — khiếm khuyết 193 mà phép đếm
// của 282 bỏ sót — nay gắn vào cùng bộ id như bốn trang dưới; không trang nào trong `apps/web/trang/` còn tự gọi `/auth/redeem`.
//
// Bốn trang người mua — `/login` (`mo-thau`), `/tao-thau`, `/nhom-hang`, `/chinh-sach` — cùng một bước 1: mã tổ chức và mã đăng
// nhập từ link, rồi TOTP. Tới trước vòng này bước ấy có HAI hình dạng: `/login` đã tách «lấy bí mật ghi danh» khỏi «vào» (khoản 193,
// S1.230) và có khối «link đăng nhập gần đây» (khoản 195, S1.216); ba trang kia chép nguyên khối cũ — nút Vào gọi `/auth/redeem` rồi
// `/auth/totp` trong một lượt, bí mật ghi danh hiện CÙNG chỗ câu lỗi, ô mã sáu số hiện sẵn —, nên người mở thẳng `/tao-thau` với link
// còn hạn gặp lại đúng khiếm khuyết 193. Chủ dự án chốt ngày 2026-09-30 (câu 11, cách ⒝): MỘT module mà bốn trang import và gắn vào
// CÙNG bộ id (`ID_BUOC_MOT`) — tệp này, phục vụ ở `/lib/dang-nhap.js` (`MODULE_WEB`). Nó mang ba thứ, và chỉ ba:
//   ⑴ bước 1 đã tách của khoản 193 — «Tiếp» đổi mã đăng nhập ở máy chủ ĐÚNG MỘT LẦN cho mỗi mã và nói tài khoản cần ghi danh hay
//      không; bí mật ghi danh ở khối riêng, với nhãn nói nó là gì và KHÔNG phải gì; ô mã sáu số ẩn tới khi máy chủ đã nói. «Vào»
//      đổi mã nếu chưa đổi (dừng nếu vừa nhận bí mật), gọi `/auth/totp`, xoá mảnh link khỏi thanh địa chỉ (ADR-020 mục 3), hỏi
//      `/me` rồi TRAO cho trang mở các bước của nó (`daVao`). Ô tổ chức đọc bằng `docMaToChuc` (ADR-107: nhận nguyên link cũ).
//      [S1.249 / khoản 292] Mỗi lần đổi mã (`datLai`, dán mã khác) là một lượt mới: phản hồi `/auth/redeem` của lượt cũ về muộn
//      bị bỏ trọn, không gắn cho mã đang giữ. [S1.250 / khoản 310] Cả `/auth/totp` và `/me` của nút Vào — và một phản hồi chỉ được
//      nhận khi ô còn mang đúng mã đã gửi; phiên mà một lượt đã qua vừa mở ở máy chủ thì trang đóng (`/auth/logout`);
//   ⑵ khối «link đăng nhập gần đây» của khoản 195 (ADR-126) — mỗi link một dòng, bộ đếm lượt bỏ phản hồi về muộn;
//   ⑶ câu «còn nữa» của khoản 268 — thân `GET /auth/login-links` mang `truncated`.
// Phần còn lại của bước 1 ở lại MỖI trang, có chủ đích: đọc mảnh link (`docLink`), hỏi lại phiên lúc tải và «Tiếp tục với phiên
// này» (`thuPhienCo`, [S1.177]), đăng xuất, `hashchange` — mỗi trang dọn trạng thái RIÊNG của nó khi về bước 1 (gói đang mở, ngân
// sách, luồng mời…), rồi gọi `datLai()` của module; chín ca `[S1.177]` chung của `phuc-vu.test.ts` đo cả ~~bốn~~ [S1.249 / khoản 291]
// năm.
//
// Không một chỗ nào ở đây chạm `document`, `fetch`, `history` hay `location` toàn cục: trang TRAO chúng vào. Hai lý do đo được,
// không phải khẩu vị: `tsconfig` của kho không có `lib: ["DOM"]` (ADR-044 — một tên DOM ở đây là lỗi `tsc`), và `phuc-vu.test.ts`
// chạy trang trong `node:vm` với DOM giả còn hàm của module chạy ở realm của test — nên nó phải nhận DOM giả từ trang chứ không tự
// tìm. Mọi chữ đi ra màn đi qua `textContent`; `phuc-vu.test.ts` quét mã đã gỡ kiểu của mọi module `MODULE_WEB` để không sink HTML
// nào lọt vào (luật eslint của [S1.107] chỉ đọc `apps/web/trang/*.js`, và module này là module ĐẦU TIÊN của `MODULE_WEB` chạm DOM).
// ==============================================================================================

/** [S1.176 / ADR-107] Hình dạng mã tổ chức — UUID (ADR-012). `/login` dùng cả ở `docLink` (link `#<orgId>` trơn). */
export const LA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const SAI_TO_CHUC =
  "Mã tổ chức có dạng 00000000-0000-0000-0000-000000000000 — phần sau dấu # và trước dấu hai chấm của một link TrustProcure đã gửi.";

const MAT_KET_NOI = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

/**
 * [S1.176 / ADR-107] Đọc ô tổ chức: nhận cả một link cũ dán vào (lấy phần sau `#`, trước `:`), vì mã tổ chức nằm đúng ở đó trong mọi
 * link sản phẩm gửi. Trả `""` khi ô rỗng, `null` khi sai hình dạng — để trang nói đúng lỗi thay vì câu `thiếu trường "orgId"` của máy
 * chủ trong khi ô vẫn đầy. [S1.240 / khoản 282] Từng là `docToChuc()` riêng của `mo-thau.js`; nay bước 1 của bốn trang và ô xin link
 * của `/login` đọc qua CÙNG hàm này.
 */
export function docMaToChuc(giaTri: string): string | null {
  let s = giaTri.trim();
  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(h + 1);
  const c = s.indexOf(":");
  if (c >= 0) s = s.slice(0, c);
  s = s.trim();
  if (s === "") return "";
  return LA_UUID.test(s) ? s : null;
}

// ---------------------------------------------------------------------------------------------
// [S1.216 / khoản 195 · S1.240 / khoản 268] Câu của khối «link đăng nhập gần đây» — phép tính thuần, `dang-nhap.test.ts` đo.
// ---------------------------------------------------------------------------------------------

/**
 * [S1.240 / khoản 268] Cửa sổ của danh sách, tính bằng ngày — cùng số với `CUA_SO_LINK_GAN_DAY_NGAY` của
 * `packages/identity/src/login.ts` (máy chủ cắt ở đó; `dang-nhap.test.ts` đối chiếu hai số bằng văn bản nguồn).
 */
export const CUA_SO_NGAY_LINK_GAN_DAY = 7;

/** Một link như `GET /auth/login-links` trả — trang đọc bốn trường; kiểu `unknown` vì thân là JSON của máy chủ. */
export interface LinkGanDay {
  readonly createdAt?: unknown;
  readonly expiresAt?: unknown;
  readonly consumedAt?: unknown;
  readonly status?: unknown;
}

/** Giờ theo trình duyệt của người đọc, không phải chuỗi ISO của máy. */
function gio(s: unknown): string {
  return typeof s === "string" ? new Date(s).toLocaleString("vi-VN") : "—";
}

/** Vế phải của một dòng: đã dùng lúc Y / hết hạn lúc Y, chưa dùng / còn hiệu lực tới Y, chưa dùng (trạng thái suy ở CSDL). */
export function moTaLinkDangNhap(l: LinkGanDay): string {
  if (l.status === "CONSUMED") return `đã dùng lúc ${gio(l.consumedAt)}`;
  if (l.status === "EXPIRED") return `hết hạn lúc ${gio(l.expiresAt)}, chưa dùng`;
  return `còn hiệu lực tới ${gio(l.expiresAt)}, chưa dùng`;
}

/** Các cặp dt/dd của khối: mỗi link một dòng «Link lúc X» → vế phải; rỗng ⇒ một dòng «chưa có». */
export function hangLinkGanDay(ds: readonly LinkGanDay[]): readonly (readonly [string, string])[] {
  if (ds.length === 0) return [["Link đăng nhập gần đây", "chưa có"]];
  return ds.map((l) => [`Link lúc ${gio(l.createdAt)}`, moTaLinkDangNhap(l)] as const);
}

/**
 * Câu dưới tiêu đề khối. Nói cửa sổ ở MỌI lần — một link cũ hơn thế không hiện ở đây — và việc phải làm khi một link «đã dùng» không
 * phải do mình. [S1.240 / khoản 268] `conNua` (thân mang `truncated: true`) ⇒ nối câu «Còn nữa» nói trang đang hiện bao nhiêu link
 * mới nhất: một danh sách bị cắt phải nói mình bị cắt, và chừng ấy link trong một tuần tự nó là một dấu hiệu.
 */
export function cauLinkGanDay(conNua: boolean, soDong: number): string {
  const ngay = String(CUA_SO_NGAY_LINK_GAN_DAY);
  const cau =
    `Link đăng nhập của chính bạn trong ${ngay} ngày gần đây, mới nhất trước. Một link «đã dùng» vào lúc không phải bạn đăng nhập ` +
    "nghĩa là người khác đã dùng link của bạn — đăng xuất và báo ngay cho quản trị tổ chức.";
  if (!conNua) return cau;
  return `${cau} Còn nữa: trong ${ngay} ngày ấy bạn có nhiều link hơn số trang đang hiện — trang chỉ hiện ${String(soDong)} link mới ` +
    "nhất. Chừng ấy link trong một tuần là điều bất thường: báo quản trị tổ chức.";
}

// ---------------------------------------------------------------------------------------------
// [S1.240 / khoản 282] Gắn bước 1 vào một trang.
// ---------------------------------------------------------------------------------------------

/**
 * Id mà bước 1 gắn vào — ~~bốn~~ [S1.249 / khoản 291] năm trang khai ĐỦ bộ này trong HTML (`dang-nhap.test.ts` đọc cả ~~bốn~~ năm
 * tệp).
 */
export const ID_BUOC_MOT = [
  "org",
  "token",
  "nut-ghi-danh",
  "ghi-danh",
  "khoi-ma",
  "ma",
  "nut-vao",
  "loi1",
  "ok1",
  "khoi-link-gan-day",
  "ghi-link-gan-day",
  "link-gan-day",
] as const;

/** Trong `ID_BUOC_MOT`, những phần tử ẩn lúc tải — ô mã sáu số trước hết (khoản 193). */
export const ID_AN_LUC_TAI = ["ghi-danh", "khoi-ma", "loi1", "ok1", "khoi-link-gan-day", "ghi-link-gan-day"] as const;

/** Phần tử DOM — chỉ những gì bước 1 chạm; phần tử thật và phần tử giả của `phuc-vu.test.ts` đều có. */
export interface PhanTuDangNhap {
  hidden: boolean;
  textContent: string | null;
  value: string;
  disabled: boolean;
  addEventListener(loai: string, nghe: () => unknown): void;
  replaceChildren(): void;
  append(...con: PhanTuDangNhap[]): void;
}

/** `document` của trang — hai phương thức. */
export interface TaiLieuDangNhap {
  getElementById(id: string): PhanTuDangNhap | null;
  createElement(ten: string): PhanTuDangNhap;
}

/** Phản hồi của `goi(method, duong, than)` của trang — `status` và thân JSON đã đọc. */
export interface PhanHoiDangNhap {
  readonly status: number;
  readonly body: unknown;
}

export interface TuyChonDangNhap {
  /** `document` của trang. */
  readonly taiLieu: TaiLieuDangNhap;
  /** `goi` của trang: `fetch` tới `/api`, cùng origin, cookie đi kèm; NÉM khi mất mạng. */
  readonly goi: (method: string, duong: string, than?: unknown) => Promise<PhanHoiDangNhap>;
  /** `history` và `location` của trang — xoá mảnh link sau `/auth/totp` (ADR-020 mục 3). */
  readonly lichSu: { replaceState(trangThai: null, tieuDe: string, url: string): void };
  readonly viTri: { readonly pathname: string; readonly search: string };
  /**
   * Sau `/auth/totp` thành công và `/me`: trang mở các bước của nó (thân `/me`, mã tổ chức vừa dùng). Module đợi nó — nút Vào tắt tới
   * khi trang mở xong — và nó ném thì bước 1 nói câu mất kết nối, như trước ở cả bốn trang. [S1.250 / khoản 310] Chỉ gọi khi lần bấm
   * Vào còn là lượt hiện tại và ô còn mang đúng mã đã gửi.
   */
  readonly daVao: (me: unknown, orgId: string) => unknown;
}

export interface DangNhap {
  /**
   * Về bước 1 (đăng xuất, đổi mảnh link): mã đăng nhập đang ở ô phải đổi lại ở máy chủ trước khi vào, ô mã sáu số đóng và rỗng, bí
   * mật của người trước đi. Trang gọi SAU `docLink()` — lúc ô mã đã mang mã mới. [S1.249 / khoản 292] Và một lượt đổi mã mới bắt
   * đầu: phản hồi `/auth/redeem` còn bay của lượt trước bị bỏ khi về, kể cả khi ô vẫn mang cùng mã. [S1.250 / khoản 310] Cả lần
   * Vào còn bay: nó dừng ở `await` kế, và phiên nó đã kịp mở ở máy chủ bị đóng.
   */
  datLai(): void;
  /** [khoản 195 / 268] Hỏi link gần đây của chính mình và vẽ; lỗi hay 401 ⇒ khối ẩn. Trang gọi ngay khi các bước mở. */
  veLinkGanDay(): Promise<void>;
  /** [khoản 195] Khối ẩn và rỗng; phản hồi của lượt trước bị bỏ. Trang gọi khi về bước 1. */
  anLinkGanDay(): void;
}

/** Câu `error` của máy chủ nếu thân mang nó, không thì câu mặc định kèm mã trạng thái — khuôn `loiCua` của các trang. */
// [S1.255 / khoản 326] Khuôn khoản 323 (S1.254): thân 403 hằng của `apps/api` không phải một câu cho người đọc; mọi thân
// lỗi khác — kể cả 403 `nguon khong duoc phep` của lớp chống CSRF theo origin, thứ duy nhất trang này thật sự gặp — in nguyên văn.
const THAN_403 = "khong co quyen";

function loiCua(r: PhanHoiDangNhap, macDinh: string): string {
  const b = r.body;
  if (r.status === 403 && b !== null && typeof b === "object" && (b as { error?: unknown }).error === THAN_403) {
    return `${macDinh}: máy chủ từ chối vì quyền — tài khoản này không được làm việc ấy.`;
  }
  if (b !== null && typeof b === "object" && typeof (b as { error?: unknown }).error === "string") return (b as { error: string }).error;
  return `${macDinh} (mã ${String(r.status)})`;
}

/** Trường `k` của một thân JSON, hay `undefined`. */
function truong(than: unknown, k: string): unknown {
  return than !== null && typeof than === "object" ? (than as Record<string, unknown>)[k] : undefined;
}

/**
 * Gắn bước 1 vào trang: trình nghe của nút Tiếp (`nut-ghi-danh`) và nút Vào (`nut-vao`), cùng khối link gần đây. Không gọi máy chủ lúc
 * gắn — ca `[S1.177]` «link mang mã mở trong trình duyệt có phiên của người khác ⇒ không hỏi gì» đo điều ấy. Ném nếu trang thiếu một
 * id của `ID_BUOC_MOT`: một bước 1 gắn thiếu phải hỏng lúc tải, không phải lúc người dùng bấm.
 */
export function ganDangNhap(tc: TuyChonDangNhap): DangNhap {
  const $ = (id: string): PhanTuDangNhap => {
    const e = tc.taiLieu.getElementById(id);
    if (e === null) throw new Error(`dang-nhap: trang thiếu phần tử #${id}`);
    return e;
  };
  for (const id of ID_BUOC_MOT) $(id);
  const hien = (e: PhanTuDangNhap, co: boolean): void => {
    e.hidden = !co;
  };
  const bao = (e: PhanTuDangNhap, chu: string): void => {
    e.textContent = chu;
    hien(e, chu !== "");
  };

  // Mã đăng nhập mà phiên của trang đang giữ, và máy chủ đã đổi nó chưa — hai thứ `phien.token` / `phien.daRedeem` của mỗi trang
  // trước vòng này, nay MỘT chỗ.
  let dangGiu = { token: "", daRedeem: false };
  // [S1.249 / khoản 292] Lượt đổi mã: tăng MỖI lần `dangGiu` đổi chủ (`doiMa` — kể cả qua `datLai`). `doiMaDangNhap` chụp nó trước
  // `await` và bỏ phản hồi của lượt đã qua — cùng khuôn `luotLinkGanDay` của khối link gần đây (khoản 195).
  let luotDoiMa = 0;
  /**
   * [S1.250 / khoản 310] Phản hồi của một lời gọi đi ở lượt `luot`, cho mã `token`, còn được NHẬN không: cùng lượt, VÀ ô mã đăng nhập
   * còn mang đúng mã ấy. Vế thứ hai bắt cảnh mà bộ đếm không thấy: người sau dán mã của mình vào ô mà CHƯA bấm — module chỉ biết mã
   * đổi khi một nút đọc ô (`docHaiO`), nên trước vòng này phản hồi của mã cũ vẫn vẽ (đo ở §S1.249: bí mật ghi danh của mã cũ hiện
   * dưới mã mới tới lần bấm kế). So ô LÚC PHẢN HỒI VỀ, không nghe sự kiện `input`: nghe thì một phím gõ nhầm vào ô sau khi bí mật đã
   * hiện sẽ đóng nó, và lần Tiếp sau đó sinh bí mật MỚI trong khi ứng dụng xác thực đã giữ bí mật cũ.
   */
  const conHieuLuc = (luot: number, token: string): boolean => luot === luotDoiMa && $("token").value.trim() === token;

  /** Ô mã sáu số chỉ có nghĩa sau khi máy chủ đã nói tài khoản cần ghi danh hay không — đóng nó cùng lúc `daRedeem` về false. */
  function dongKhoiMa(giuMaSauSo: boolean): void {
    hien($("khoi-ma"), false);
    if (!giuMaSauSo) $("ma").value = "";
    bao($("ghi-danh"), "");
  }

  /**
   * Mã đăng nhập vừa đổi (người thứ hai dán mã của mình): phải đổi lại ở máy chủ; ô mã sáu số đóng, bí mật của người trước không
   * được đứng lại. `giuMaSauSo`: từ nút Vào, mã sáu số vừa gõ đi cùng mã vừa dán nên giữ; từ nút Tiếp, nó là của người trước nên xoá.
   */
  function doiMa(token: string, giuMaSauSo: boolean): void {
    luotDoiMa += 1;
    dangGiu = { token, daRedeem: false };
    dongKhoiMa(giuMaSauSo);
  }

  /**
   * Đổi mã đăng nhập ở máy chủ, ĐÚNG MỘT LẦN cho mỗi mã — mỗi lần gọi lại, máy chủ sinh một bí mật TOTP MỚI cho tài khoản chưa ghi
   * danh, và mã sáu số của người vừa gõ bí mật cũ không bao giờ đúng nữa (lượt chạy thử đầu tiên của `/login` đo đúng thế).
   * Trả `"ghi-danh"` khi vừa nhận bí mật, `"san-sang"` khi ô mã sáu số dùng được, `null` khi máy chủ từ chối (câu đã ở `loi1`)
   * [S1.249 / khoản 292] hay khi phản hồi thuộc một lượt đã qua (không vẽ gì) — [S1.250 / khoản 310] hay ô đã mang mã khác. Ném
   * khi mất mạng — [S1.249 / khoản 292] chỉ khi lượt còn là lượt hiện tại.
   */
  async function doiMaDangNhap(orgId: string, token: string): Promise<"ghi-danh" | "san-sang" | null> {
    if (dangGiu.daRedeem) {
      hien($("khoi-ma"), true);
      return "san-sang";
    }
    // [S1.249 / khoản 292] Lượt của lần đổi này, chụp TRƯỚC `await`. Trong lúc chờ, thẻ có thể đã về bước 1 (`datLai` — đăng xuất,
    // `hashchange`) hay người khác đã dán mã của mình (`doiMa`): phản hồi khi ấy là của mã CŨ, và đặt `daRedeem` hay vẽ bí mật lúc
    // ấy là gắn nó cho mã đang giữ — mã của người sau (đo: bí mật ghi danh của A hiện dưới mã của B, Tiếp không bao giờ đổi mã của B,
    // Vào của mã cũ đi tới `/auth/totp`). Nên nó bị bỏ TRỌN — 200, từ chối hay mất mạng: không đặt, không vẽ `ghi-danh`/`ok1`/`loi1`,
    // không mở ô mã sáu số; `null` để nút Vào dừng.
    const luot = luotDoiMa;
    let r1: PhanHoiDangNhap;
    try {
      r1 = await tc.goi("POST", "/auth/redeem", { orgId, token });
    } catch (loi) {
      // [S1.250 / khoản 310] ~~`luot !== luotDoiMa`~~ — cùng phép kiểm, cộng ô còn mang mã đã gửi (`conHieuLuc`).
      if (!conHieuLuc(luot, token)) return null;
      throw loi;
    }
    if (!conHieuLuc(luot, token)) return null;
    if (r1.status !== 200) {
      bao($("loi1"), loiCua(r1, "Mã đăng nhập không dùng được"));
      return null;
    }
    dangGiu = { ...dangGiu, daRedeem: true };
    hien($("khoi-ma"), true);
    if (truong(r1.body, "needsEnrollment") === true) {
      // Lần đầu của một người mua: máy chủ trả bí mật TOTP đúng một lần. Hiện nguyên văn thay vì giấu sau một mã QR — người đang demo
      // cần gõ nó vào ứng dụng xác thực ngay tại chỗ. Nhãn nói cả hai chiều: nó là gì (bí mật ghi danh, nhập vào ứng dụng xác thực)
      // và nó KHÔNG phải gì (mã đăng nhập, mã sáu số) — vì đó đúng là hai thứ người mới đã lẫn.
      bao(
        $("ghi-danh"),
        `Tài khoản này chưa có ứng dụng xác thực. BÍ MẬT GHI DANH: ${String(truong(r1.body, "totpSecretBase32"))} — nhập nó vào ` +
          "ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…). Đây KHÔNG phải mã đăng nhập và " +
          "không phải mã sáu số. Xong thì nhập mã sáu số ứng dụng hiện ra vào ô dưới và bấm Vào.",
      );
      return "ghi-danh";
    }
    bao($("ok1"), "Mã đăng nhập hợp lệ; tài khoản đã có ứng dụng xác thực. Nhập mã sáu số rồi bấm Vào.");
    return "san-sang";
  }

  /** ADR-020 mục 3: xoá mảnh link SAU `/auth/totp` — mã đã tiêu thụ nên xoá nó không làm mất gì. `replaceState` không bắn `hashchange`. */
  function xoaManhLink(): void {
    try {
      tc.lichSu.replaceState(null, "", tc.viTri.pathname + tc.viTri.search);
    } catch {
      /* không xoá được thì thôi */
    }
  }

  /**
   * [S1.250 / khoản 310] Đóng phiên mà một lần Vào ĐÃ QUA vừa mở ở máy chủ: `/auth/totp` trả 200 nên cookie phiên của người trước
   * đã vào trình duyệt, nhưng thẻ đã sang lượt khác (`hashchange`, đăng xuất, dán mã khác) trước khi trang trao phiên ấy cho các bước.
   * Bỏ phản hồi mà để cookie nằm lại là để một phiên KHÔNG AI THẤY sống tới hết hạn trong trình duyệt: dưới câu «Đã đăng xuất. Trình
   * duyệt này không còn giữ phiên của bạn.» của chính trang, hay sau lời hỏi `/me` của lượt mới về một phiên khác — lúc ấy «Tiếp tục
   * với phiên này» mở các bước mang tên người này mà thao tác dưới cookie của người kia. Nên trang thu hồi nó bằng chính route đăng
   * xuất sẵn có (`POST /auth/logout`: thu hồi phiên của cookie đang gửi và xoá cookie), im lặng, và lỗi thì thôi. Nút Vào đợi lời gọi
   * này xong mới bật lại: lần Vào kế của người sau không chạy đua với lệnh xoá cookie. Giá: mã đăng nhập của người trước đã tiêu thụ
   * (`/auth/totp` 200) — họ xin link mới.
   */
  async function dongPhienBoDo(): Promise<void> {
    try {
      await tc.goi("POST", "/auth/logout");
    } catch {
      /* mất mạng: không đóng được thì thôi — lần đăng nhập sau thay cookie, phiên tự hết hạn ở máy chủ */
    }
  }

  /** Đọc hai ô của bước 1; câu lỗi ở `loi1` và `null` khi thiếu hay sai hình dạng. `giuMaSauSo` như `doiMa`. */
  function docHaiO(giuMaSauSo: boolean): { readonly orgId: string; readonly token: string } | null {
    const orgId = docMaToChuc($("org").value);
    const token = $("token").value.trim();
    if (token !== dangGiu.token) doiMa(token, giuMaSauSo);
    if (orgId === null) {
      bao($("loi1"), SAI_TO_CHUC);
      return null;
    }
    if (orgId === "" || token === "") {
      bao($("loi1"), "Cần cả mã tổ chức và mã đăng nhập.");
      return null;
    }
    return { orgId, token };
  }

  $("nut-ghi-danh").addEventListener("click", async () => {
    bao($("loi1"), "");
    const o = docHaiO(false);
    if (o === null) return;
    const nut = $("nut-ghi-danh");
    nut.disabled = true;
    try {
      await doiMaDangNhap(o.orgId, o.token);
    } catch {
      bao($("loi1"), MAT_KET_NOI);
    } finally {
      nut.disabled = false;
    }
  });

  $("nut-vao").addEventListener("click", async () => {
    bao($("loi1"), "");
    const code = $("ma").value.trim();
    // Đổi sang người thứ hai = dán một mã đăng nhập khác: phải đổi lại cho mã mới. Mã sáu số vừa gõ đi cùng mã vừa dán, nên giữ.
    const o = docHaiO(true);
    if (o === null) return;
    // [S1.250 / khoản 310] Lượt của lần bấm này — chụp SAU `docHaiO` (nó vừa mở lượt mới nếu ô vừa đổi mã), TRƯỚC `await` đầu. Sau
    // MỖI `await` dưới và trong `catch`: lượt đã qua (hay ô đã mang mã khác) thì im — không xoá mảnh link (nó là link của người sau),
    // không `/me`, không `daVao`, không câu nào đè lên lượt mới.
    const luot = luotDoiMa;
    const daQua = (): boolean => !conHieuLuc(luot, o.token);
    // [S1.250 / khoản 310] Phiên lần bấm này đã mở ở máy chủ (`/auth/totp` 200) mà chưa trao cho trang (`daVao`).
    let phienChuaTrao = false;
    const nut = $("nut-vao");
    nut.disabled = true;
    try {
      // Vào mà chưa đổi mã (mã vừa dán, hay bước Tiếp bị bỏ qua): đổi ở đây, cùng đường và cùng "đúng một lần" với nút Tiếp. Vừa nhận
      // bí mật thì DỪNG — mã sáu số lúc này không thể đúng, vì ứng dụng xác thực chưa có bí mật. [S1.249 / khoản 292] `null` cũng
      // dừng: máy chủ từ chối, hay mã này đã bị thay trong lúc chờ — không `/auth/totp` nào mang một mã mà ô không còn giữ.
      if ((await doiMaDangNhap(o.orgId, o.token)) !== "san-sang") return;
      if (!/^\d{6}$/u.test(code)) {
        bao($("loi1"), "Nhập mã sáu số của ứng dụng xác thực.");
        return;
      }
      const r2 = await tc.goi("POST", "/auth/totp", { orgId: o.orgId, token: o.token, code });
      phienChuaTrao = r2.status === 200;
      // [S1.250 / khoản 310] Đo ở §S1.249: thiếu dòng này thì 200 của lượt cũ xoá `#<org>:<mã>` CHƯA dùng của người sau, hỏi `/me`
      // và mở các bước dưới phiên người trước. Phiên đã mở thì `finally` đóng nó.
      if (daQua()) return;
      if (r2.status !== 200) {
        bao($("loi1"), truong(r2.body, "reason") === "LOCKED_OUT" ? "Tài khoản đang bị khoá tạm thời" : "Mã sáu số không đúng");
        return;
      }
      xoaManhLink();
      // `/me` trả `{userId, sessionId, orgId, kind}` — CỐ Ý không trả email hay tên (một route "tôi là ai" trả dữ liệu cá nhân là
      // một route mà mọi lỗ IDOR đều muốn có). Trang đọc nó để nói ai đang vào.
      const me = await tc.goi("GET", "/me");
      // [S1.250 / khoản 310] Kiểm cuối, ngay trước `daVao`: từ đây phiên đã TRAO cho trang — một lần về bước 1 sau đó là việc của
      // trang (đóng các bước, `datLai`), không phải lý do đóng phiên.
      if (daQua()) return;
      phienChuaTrao = false;
      await tc.daVao(me.body, o.orgId);
    } catch {
      // `goi` ném khi mất mạng: không có câu nào thì người dùng không biết đã vào hay chưa. [S1.250 / khoản 310] Trừ khi lượt đã
      // qua: câu ấy nói về lần Vào của người trước, không phải của người đang đứng trước màn.
      if (!daQua()) bao($("loi1"), MAT_KET_NOI);
    } finally {
      // [S1.250 / khoản 310] Lượt đã qua mà phiên đã mở chưa trao ⇒ đóng (`dongPhienBoDo`), rồi mới bật nút. Từ chối hay mất mạng
      // ở `/auth/totp` không chứng minh phiên nào đã mở — không gọi gì: một lệnh đăng xuất lúc ấy thu hồi phiên nào đang nằm trong
      // trình duyệt, kể cả phiên mà lượt mới đang hỏi «Tiếp tục với phiên này».
      if (phienChuaTrao && daQua()) await dongPhienBoDo();
      nut.disabled = false;
    }
  });

  // [S1.216 / khoản 195 / ADR-126] Link đăng nhập gần đây của CHÍNH mình — vế «báo ngay» mà thông điệp gộp ở bước đổi mã cố ý không
  // nói. Máy chủ lấy người từ cookie; khối là trợ giúp, không phải cổng: từ chối hay mất mạng ⇒ ẩn, các bước vẫn mở. Mỗi lần hỏi hay
  // mỗi lần về bước 1 là một lượt mới, và phản hồi của lượt cũ không vẽ gì (kể cả khi người khác đã vào sau đó).
  let luotLinkGanDay = 0;

  function anLinkGanDay(): void {
    luotLinkGanDay += 1;
    hien($("khoi-link-gan-day"), false);
    $("link-gan-day").replaceChildren();
    bao($("ghi-link-gan-day"), "");
  }

  async function veLinkGanDay(): Promise<void> {
    luotLinkGanDay += 1;
    const luot = luotLinkGanDay;
    try {
      const r = await tc.goi("GET", "/auth/login-links");
      if (luot !== luotLinkGanDay) return;
      const tho = truong(r.body, "loginLinks");
      if (r.status !== 200 || !Array.isArray(tho)) {
        anLinkGanDay();
        return;
      }
      const ds = tho as readonly LinkGanDay[];
      const dl = $("link-gan-day");
      dl.replaceChildren();
      for (const [k, v] of hangLinkGanDay(ds)) {
        const dt = tc.taiLieu.createElement("dt");
        dt.textContent = k;
        const dd = tc.taiLieu.createElement("dd");
        dd.textContent = v;
        dl.append(dt, dd);
      }
      // [S1.240 / khoản 268] Chỉ `true` đúng nghĩa mới là «còn nữa»: thiếu trường (API cũ), `false` hay giá trị lạ ⇒ không câu nào.
      bao($("ghi-link-gan-day"), cauLinkGanDay(truong(r.body, "truncated") === true, ds.length));
      hien($("khoi-link-gan-day"), true);
    } catch {
      if (luot === luotLinkGanDay) anLinkGanDay();
    }
  }

  return {
    // [S1.249 / khoản 292] ~~Hai câu chép của `doiMa`~~ Đúng `doiMa` với mã đang ở ô: một chỗ đổi chủ `dangGiu`, một chỗ tăng lượt.
    datLai: () => {
      doiMa($("token").value.trim(), false);
    },
    veLinkGanDay,
    anLinkGanDay,
  };
}
