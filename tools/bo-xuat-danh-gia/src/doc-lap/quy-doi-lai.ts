// ==============================================================================================
// [S1.9101 / S4.7c2] PHÉP QUY ĐỔI TCO VÀ HẠNG GIÁ, TÍNH LẠI ĐỘC LẬP — `DAC-TA.md` §9, §10 bước 4
//
// Cùng ranh giới với `tinh-lai.ts`: viết TỪ văn bản đặc tả, không import một symbol nào của `@trustprocure/danh-gia` (quy tắc
// `g17-kiem-doc-lap-khong-cham-danh-gia` canh cả thư mục).
//
// PHƯƠNG PHÁP KHÁC, NÓI RA: `packages/danh-gia` (`tco.ts`) quy ba số về `bigint` ở tỉ lệ cố định, nhân, rồi làm tròn bằng một phép
// chia nguyên `(2·tử + mẫu) / (2·mẫu)`. Ở đây số là MẢNG CHỮ SỐ (`tinh-lai.ts`): nhân dài, CHIA NGẮN cho 365 từng chữ số như chia
// trên giấy — giữ thêm MỘT chữ số lẻ sau mọi chữ số của số bị chia —, rồi làm tròn bằng cách đọc đuôi bị cắt (`thuVe`).
//
// Vì sao một chữ số lẻ thêm là ĐỦ cho làm tròn đúng: thương cắt cụt `q` có ít nhất một chữ số sau vị trí làm tròn, và phần còn thiếu
// (`dư / 365` đơn vị của chữ số cuối) nhỏ hơn một đơn vị ấy. Nếu đuôi của `q` đã ≥ một nửa thì giá trị đúng cũng ≥ một nửa; nếu đuôi
// < một nửa thì đuôi ≤ một nửa trừ một đơn vị, cộng phần thiếu (< một đơn vị) vẫn < một nửa. Quyết định làm tròn vì thế CHÍNH XÁC.
// ==============================================================================================

import { docThapPhan, nhan, thuVe, vietThapPhan, xepHangLai, type SoThapPhan } from "./tinh-lai.js";

/** Ngày khai và ngày của thước: số nguyên không âm, tối đa năm chữ số — khớp miền `bid_so_ngay` và `CHECK` của nhóm khoá `tco`. */
const KHUON_NGAY = /^(0|[1-9][0-9]{0,4})$/u;
/** Cơ sở và tỷ lệ: thập phân KHÔNG ÂM, tối đa 64 ký tự (nhân dài bậc hai theo số chữ số — một bundle độc không được làm treo). */
const KHUON_KHONG_AM = /^(?=.{1,64}$)\d+(?:\.\d+)?$/u;
/** Tiền đúng dạng §2 — cùng khuôn `award_hang_gia` (`121`) lọc `tien` của `gia`. */
const KHUON_TIEN = /^[0-9]{1,16}\.[0-9]{2}$/u;

function docNgay(chuoi: string): number | null {
  return KHUON_NGAY.test(chuoi) ? Number(chuoi) : null;
}

function khongAm(chuoi: string): SoThapPhan | null {
  return KHUON_KHONG_AM.test(chuoi) ? docThapPhan(chuoi) : null;
}

/** Nới về ít nhất `soLe` chữ số lẻ bằng số 0 ở ĐUÔI — giá trị không đổi. */
function itNhat(x: SoThapPhan, soLe: number): SoThapPhan {
  return x.soLe >= soLe ? x : { am: x.am, chuSo: [...x.chuSo, ...new Array<number>(soLe - x.soLe).fill(0)], soLe };
}

/**
 * CHIA NGẮN một số KHÔNG ÂM cho một số nguyên dương nhỏ, giữ `x.soLe + themLe` chữ số lẻ, CẮT CỤT (không làm tròn). Dư luôn nhỏ hơn
 * `mau`, nên phép tính máy ở đây chỉ chạm số < 10·mau — không bao giờ chạm giá trị đầy đủ.
 */
export function chiaNgan(x: SoThapPhan, mau: number, themLe: number): SoThapPhan {
  if (x.am) throw new RangeError("chiaNgan chỉ chia số không âm");
  if (!Number.isInteger(mau) || mau <= 0 || mau > 1_000_000) throw new RangeError("chiaNgan chỉ chia cho số nguyên dương nhỏ");
  const bi = [...x.chuSo, ...new Array<number>(themLe).fill(0)];
  const thuong: number[] = [];
  let du = 0;
  for (const c of bi) {
    du = du * 10 + c;
    thuong.push(Math.floor(du / mau));
    du %= mau;
  }
  return { am: false, chuSo: thuong, soLe: x.soLe + themLe };
}

/**
 * `DAC-TA.md` §9.1 — `LÀM_TRÒN(max(0, ngayChuan − ngayKhai) × tyLe × coSo ÷ 365, 2)`. `null` khi một đầu vào không đọc được — một
 * kết luận, không phải một lỗi.
 */
export function chiPhiThanhToanLai(coSo: string, ngayKhai: string, ngayChuan: string, tyLe: string): string | null {
  const t = khongAm(coSo);
  const r = khongAm(tyLe);
  const k = docNgay(ngayKhai);
  const c = docNgay(ngayChuan);
  if (t === null || r === null || k === null || c === null) return null;
  const d = docThapPhan(String(Math.max(0, c - k)));
  if (d === null) return null;
  const tich = itNhat(nhan(nhan(d, r), t), 2);
  return vietThapPhan(thuVe(chiaNgan(tich, 365, 1), 2));
}

/** `DAC-TA.md` §9.2 — `LÀM_TRÒN(max(0, ngayKhai − ngayYeuCau) × tyLe × coSo, 2)`. */
export function chiPhiTreLai(coSo: string, ngayKhai: string, ngayYeuCau: string, tyLe: string): string | null {
  const t = khongAm(coSo);
  const r = khongAm(tyLe);
  const k = docNgay(ngayKhai);
  const y = docNgay(ngayYeuCau);
  if (t === null || r === null || k === null || y === null) return null;
  const d = docThapPhan(String(Math.max(0, k - y)));
  if (d === null) return null;
  return vietThapPhan(thuVe(itNhat(nhan(nhan(d, r), t), 2), 2));
}

/** Một hàng của lượt chấm, đủ cho hạng giá: hạng chi phí và `tien` của phần tử `gia` ĐẦU TIÊN (hay `null`). */
export interface HangChoHangGia {
  readonly bidVersionId: string;
  readonly rank: number | null;
  readonly tienGia: string | null;
}

/**
 * `DAC-TA.md` §10 bước 4 — hạng giá của `bidVersionId` trên các hàng CÓ hạng của lượt chấm: `tien` đúng dạng §2 của phần tử `gia`
 * đầu tiên, xếp như §5. `null` khi báo giá ấy không có hạng hay không có `tien` ấy.
 */
export function hangGiaLai(hang: readonly HangChoHangGia[], bidVersionId: string): number | null {
  return bangHangGiaLai(hang).get(bidVersionId) ?? null;
}

/**
 * Hạng giá của MỌI báo giá có hạng của một lượt chấm, một lần — [rà soát §S1.9101 — TRUNG-2] tính lại cả phép xếp cho TỪNG cam kết
 * là O(cam kết × hàng × log hàng), và một bundle độc nhiều đề xuất làm bộ kiểm treo.
 */
export function bangHangGiaLai(hang: readonly HangChoHangGia[]): ReadonlyMap<string, number | null> {
  const coHang = hang.filter((h) => h.rank !== null);
  const gia = coHang.map((h) => (h.tienGia !== null && KHUON_TIEN.test(h.tienGia) ? h.tienGia : null));
  const xep = xepHangLai(gia);
  return new Map(coHang.map((h, i) => [h.bidVersionId, xep[i] ?? null]));
}
