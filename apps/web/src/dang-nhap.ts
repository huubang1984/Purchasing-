// ==============================================================================================
// [S1.240 / khoản 282] BƯỚC 1 CỦA BỐN TRANG NGƯỜI MUA — MỘT BẢN, MỘT PHÉP ĐO
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
//      `/me` rồi TRAO cho trang mở các bước của nó (`daVao`). Ô tổ chức đọc bằng `docMaToChuc` (ADR-107: nhận nguyên link cũ);
//   ⑵ khối «link đăng nhập gần đây» của khoản 195 (ADR-126) — mỗi link một dòng, bộ đếm lượt bỏ phản hồi về muộn;
//   ⑶ câu «còn nữa» của khoản 268 — thân `GET /auth/login-links` mang `truncated`.
// Phần còn lại của bước 1 ở lại MỖI trang, có chủ đích: đọc mảnh link (`docLink`), hỏi lại phiên lúc tải và «Tiếp tục với phiên
// này» (`thuPhienCo`, [S1.177]), đăng xuất, `hashchange` — mỗi trang dọn trạng thái RIÊNG của nó khi về bước 1 (gói đang mở, ngân
// sách, luồng mời…), rồi gọi `datLai()` của module; chín ca `[S1.177]` chung của `phuc-vu.test.ts` đo cả bốn.
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

/** Id mà bước 1 gắn vào — bốn trang khai ĐỦ bộ này trong HTML (`dang-nhap.test.ts` đọc cả bốn tệp). */
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
   * khi trang mở xong — và nó ném thì bước 1 nói câu mất kết nối, như trước ở cả bốn trang.
   */
  readonly daVao: (me: unknown, orgId: string) => unknown;
}

export interface DangNhap {
  /**
   * Về bước 1 (đăng xuất, đổi mảnh link): mã đăng nhập đang ở ô phải đổi lại ở máy chủ trước khi vào, ô mã sáu số đóng và rỗng, bí
   * mật của người trước đi. Trang gọi SAU `docLink()` — lúc ô mã đã mang mã mới.
   */
  datLai(): void;
  /** [khoản 195 / 268] Hỏi link gần đây của chính mình và vẽ; lỗi hay 401 ⇒ khối ẩn. Trang gọi ngay khi các bước mở. */
  veLinkGanDay(): Promise<void>;
  /** [khoản 195] Khối ẩn và rỗng; phản hồi của lượt trước bị bỏ. Trang gọi khi về bước 1. */
  anLinkGanDay(): void;
}

/** Câu `error` của máy chủ nếu thân mang nó, không thì câu mặc định kèm mã trạng thái — khuôn `loiCua` của các trang. */
function loiCua(r: PhanHoiDangNhap, macDinh: string): string {
  const b = r.body;
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
    dangGiu = { token, daRedeem: false };
    dongKhoiMa(giuMaSauSo);
  }

  /**
   * Đổi mã đăng nhập ở máy chủ, ĐÚNG MỘT LẦN cho mỗi mã — mỗi lần gọi lại, máy chủ sinh một bí mật TOTP MỚI cho tài khoản chưa ghi
   * danh, và mã sáu số của người vừa gõ bí mật cũ không bao giờ đúng nữa (lượt chạy thử đầu tiên của `/login` đo đúng thế).
   * Trả `"ghi-danh"` khi vừa nhận bí mật, `"san-sang"` khi ô mã sáu số dùng được, `null` khi máy chủ từ chối (câu đã ở `loi1`).
   * Ném khi mất mạng.
   */
  async function doiMaDangNhap(orgId: string, token: string): Promise<"ghi-danh" | "san-sang" | null> {
    if (dangGiu.daRedeem) {
      hien($("khoi-ma"), true);
      return "san-sang";
    }
    const r1 = await tc.goi("POST", "/auth/redeem", { orgId, token });
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
    const nut = $("nut-vao");
    nut.disabled = true;
    try {
      // Vào mà chưa đổi mã (mã vừa dán, hay bước Tiếp bị bỏ qua): đổi ở đây, cùng đường và cùng "đúng một lần" với nút Tiếp. Vừa nhận
      // bí mật thì DỪNG — mã sáu số lúc này không thể đúng, vì ứng dụng xác thực chưa có bí mật.
      if ((await doiMaDangNhap(o.orgId, o.token)) !== "san-sang") return;
      if (!/^\d{6}$/u.test(code)) {
        bao($("loi1"), "Nhập mã sáu số của ứng dụng xác thực.");
        return;
      }
      const r2 = await tc.goi("POST", "/auth/totp", { orgId: o.orgId, token: o.token, code });
      if (r2.status !== 200) {
        bao($("loi1"), truong(r2.body, "reason") === "LOCKED_OUT" ? "Tài khoản đang bị khoá tạm thời" : "Mã sáu số không đúng");
        return;
      }
      xoaManhLink();
      // `/me` trả `{userId, sessionId, orgId, kind}` — CỐ Ý không trả email hay tên (một route "tôi là ai" trả dữ liệu cá nhân là
      // một route mà mọi lỗ IDOR đều muốn có). Trang đọc nó để nói ai đang vào.
      const me = await tc.goi("GET", "/me");
      await tc.daVao(me.body, o.orgId);
    } catch {
      // `goi` ném khi mất mạng: không có câu nào thì người dùng không biết đã vào hay chưa.
      bao($("loi1"), MAT_KET_NOI);
    } finally {
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
    datLai: () => {
      dangGiu = { token: $("token").value.trim(), daRedeem: false };
      dongKhoiMa(false);
    },
    veLinkGanDay,
    anLinkGanDay,
  };
}
