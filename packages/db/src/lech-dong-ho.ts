// ==============================================================================================
// [khoản 196 / ADR-069 phần 1] CANH LỆCH GIỮA ĐỒNG HỒ CSDL VÀ ĐỒNG HỒ TIẾN TRÌNH
//
// Hạn nộp thầu được phán xử bằng `now()` của CSDL (C1, `bid_kiem_han_nop`), và các trigger đóng
// RFQ của 011/022/058/059 cũng thế. Ngày 2026-09-20 đồng hồ container Postgres chậm 6 giờ 22 phút
// sau một đêm máy ngủ, và cổng C1 chặn một lần nộp mà mọi đồng hồ khác đều cho là còn hạn. Trước
// vòng này KHÔNG lớp nào so hai đồng hồ: tiến trình lên, phục vụ, và không một dòng log nào nói
// rằng thứ nó đang tin là giờ của CSDL đã trôi.
//
// HAI ĐƯỜNG DÙNG, MỘT PHÉP ĐO:
//   ⑴ lúc KHỞI ĐỘNG — `kiemLechDongHo` NÉM `LechDongHoError` khi lệch quá ngưỡng, và composition
//      root của `apps/api` và `apps/unseal-worker` gọi nó TRƯỚC khi mở cổng hay chạy vòng poll: một
//      tiến trình mà đồng hồ CSDL đã trôi thì không lên, thay vì phục vụ những phán quyết hạn nộp
//      mà không ai đối chiếu được;
//   ⑵ lúc CHẠY — `canhLechDongHoDinhKy` đo lại theo nhịp và GỌI LẠI người gọi (một dòng log cảnh báo
//      có tên), KHÔNG dừng tiến trình: đồng hồ trôi GIỮA chừng thì chặn mọi yêu cầu là một quyết định
//      vận hành, không phải của một bộ đếm giờ.
//
// PHÉP ĐO TRỪ NỬA KHỨ HỒI. Đọc `clock_timestamp()` của CSDL giữa hai lần đọc đồng hồ tiến trình
// `t0` và `t1`; giờ CSDL được so với ĐIỂM GIỮA `t0 + (t1 − t0)/2`, không với `t0` hay `t1`. Sai số
// còn lại bị chặn bởi nửa khứ hồi (khi đường đi và đường về bất đối xứng), nên hàm đo BA lần và
// giữ lần có khứ hồi NGẮN NHẤT — khuôn của NTP, không phải một phát minh. `clock_timestamp()` chứ
// không `now()`: `now()` là giờ MỞ giao dịch, còn phép đo cần giờ LÚC CÂU CHẠY; cả hai đọc cùng một
// đồng hồ hệ thống của máy CSDL.
//
// KHÔNG IN BÍ MẬT: thông điệp và dòng log chỉ mang ba con số (lệch, khứ hồi, ngưỡng) — không URL
// CSDL, không tên vai, không giá trị biến môi trường.
// ==============================================================================================

import type pg from "pg";

/** Ngưỡng mặc định — ADR-069: hai giây, cấu hình được qua `TRUSTPROCURE_CLOCK_SKEW_MAX_MS`. */
export const LECH_DONG_HO_TOI_DA_MS_MAC_DINH = 2000;
/** Nhịp đo lại mặc định lúc chạy — cấu hình được qua `TRUSTPROCURE_CLOCK_SKEW_CHECK_MS`. */
export const CHU_KY_CANH_DONG_HO_MS_MAC_DINH = 60_000;
/** Số lần đo trong một phép đo; giữ lần khứ hồi ngắn nhất. */
const SO_LAN_DO = 3;

/**
 * Câu đọc đồng hồ CSDL, ra mili-giây kể từ epoch. `date_part` trả `double precision` nên phần lẻ
 * micro-giây còn nguyên; ép `float8` để `pg` trả một `number` chứ không một chuỗi.
 */
const CAU_DOC_DONG_HO =
  "SELECT (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) OPERATOR(pg_catalog.*) 1000)::pg_catalog.float8 AS ms";

/** Đồng hồ tiến trình, mili-giây kể từ epoch. Tiêm được để đo — mặc định `Date.now`. */
export type DongHo = () => number;

/** Thứ chạy được một câu SQL — một pool hay một client đã mượn. */
export interface NguonTruyVan {
  query<R extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<R>>;
}

export interface PhepDoLechDongHo {
  /** Giờ CSDL trừ giờ tiến trình (điểm giữa khứ hồi), ms. Dương ⇒ CSDL chạy NHANH hơn tiến trình. */
  readonly lechMs: number;
  /** Khứ hồi của lần đo được giữ, ms — sai số của `lechMs` không vượt nửa con số này. */
  readonly khuHoiMs: number;
}

/** Lệch quá ngưỡng. Chỉ mang ba con số — không bí mật nào. */
export class LechDongHoError extends Error {
  public constructor(
    public readonly lechMs: number,
    public readonly khuHoiMs: number,
    public readonly nguongMs: number,
  ) {
    super(
      `đồng hồ CSDL lệch ${moTaLech(lechMs)} so với đồng hồ tiến trình (khứ hồi ${Math.round(khuHoiMs)} ms, ` +
        `ngưỡng ${nguongMs} ms). Hạn nộp thầu được phán xử bằng now() của CSDL (C1), nên tiến trình KHÔNG lên ` +
        "khi hai đồng hồ không khớp: đồng bộ lại nguồn thời gian của máy CSDL hay của máy này (ADR-069), " +
        "rồi khởi động lại.",
    );
    this.name = "LechDongHoError";
  }
}

/** `+1234 ms` / `-1234 ms` — dấu nói CSDL nhanh hay chậm hơn. */
export function moTaLech(lechMs: number): string {
  const r = Math.round(lechMs);
  return `${r >= 0 ? "+" : ""}${r} ms`;
}

/** Lệch có vượt ngưỡng không — so trị tuyệt đối, cả hai chiều đều hỏng như nhau. */
export function vuotNguong(p: PhepDoLechDongHo, nguongMs: number): boolean {
  return Math.abs(p.lechMs) > nguongMs;
}

/**
 * Đo lệch: `SO_LAN_DO` lần, giữ lần có khứ hồi ngắn nhất. Giờ CSDL so với ĐIỂM GIỮA khứ hồi.
 * Ném nếu câu đọc không trả một số hữu hạn — một phép đo không đo được gì không được đọc thành "khớp".
 */
export async function doLechDongHo(nguon: NguonTruyVan, dongHo: DongHo = Date.now): Promise<PhepDoLechDongHo> {
  let tot: PhepDoLechDongHo | null = null;
  for (let i = 0; i < SO_LAN_DO; i += 1) {
    const t0 = dongHo();
    const { rows } = await nguon.query<{ ms: unknown }>(CAU_DOC_DONG_HO);
    const t1 = dongHo();
    const ms = rows[0]?.ms;
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
      throw new Error("không đọc được đồng hồ CSDL: câu đọc clock_timestamp() không trả một số hữu hạn");
    }
    const khuHoiMs = t1 - t0;
    const p: PhepDoLechDongHo = { lechMs: ms - (t0 + khuHoiMs / 2), khuHoiMs };
    if (tot === null || p.khuHoiMs < tot.khuHoiMs) tot = p;
  }
  // `SO_LAN_DO` ≥ 1 nên `tot` luôn đã gán; nhánh dưới chỉ để trình biên dịch không phải tin lời.
  if (tot === null) throw new Error("không có phép đo nào");
  return tot;
}

/** Đường ⑴: đo và NÉM `LechDongHoError` khi vượt ngưỡng. Trả phép đo khi khớp. */
export async function kiemLechDongHo(
  nguon: NguonTruyVan,
  nguongMs: number,
  dongHo: DongHo = Date.now,
): Promise<PhepDoLechDongHo> {
  const p = await doLechDongHo(nguon, dongHo);
  if (vuotNguong(p, nguongMs)) throw new LechDongHoError(p.lechMs, p.khuHoiMs, nguongMs);
  return p;
}

export interface TuyChonCanhDinhKy {
  readonly nguon: NguonTruyVan;
  readonly nguongMs: number;
  readonly chuKyMs: number;
  readonly dongHo?: DongHo;
  /** Gọi khi một lần đo vượt ngưỡng — người gọi ghi MỘT dòng log cảnh báo có tên. */
  readonly baoLech: (p: PhepDoLechDongHo) => void;
  /** Gọi khi lần đo hỏng (mất kết nối, câu lỗi) — một phép canh không được hỏng trong im lặng. */
  readonly baoLoi: (loi: unknown) => void;
}

/**
 * Đường ⑵: đo lại theo nhịp, gọi lại khi vượt ngưỡng. Không dừng tiến trình. Bộ hẹn giờ `unref`
 * nên nó không giữ tiến trình sống; một lần đo còn đang chạy thì nhịp kế tiếp bỏ qua, nên một CSDL
 * chậm không chồng các lần đo lên nhau. Trả hàm dừng.
 */
export function canhLechDongHoDinhKy(tc: TuyChonCanhDinhKy): () => void {
  const dongHo = tc.dongHo ?? Date.now;
  let dangDo = false;
  const hen = setInterval(() => {
    if (dangDo) return;
    dangDo = true;
    doLechDongHo(tc.nguon, dongHo)
      .then((p) => {
        if (vuotNguong(p, tc.nguongMs)) tc.baoLech(p);
      })
      .catch((loi: unknown) => tc.baoLoi(loi))
      .finally(() => {
        dangDo = false;
      });
  }, tc.chuKyMs);
  hen.unref();
  return () => clearInterval(hen);
}
