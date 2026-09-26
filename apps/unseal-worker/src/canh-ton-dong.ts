// ==============================================================================================
// apps/unseal-worker/src/canh-ton-dong.ts — [ADR-083] DÒNG LOG TỒN ĐỌNG OUTBOX, ĐỊNH KỲ
//
// Cảnh báo lỗi nghiệp vụ cần biết một điều mà không tiến trình nào tự nói ra: *hàng đợi có đang
// được rút không?* Runner chết, treo, hay chạy mà không nhặt được `kind` nào đều IM LẶNG — và
// ở tiến trình mở thầu thì im lặng nghĩa là phong bì không ai mở mà không ai biết.
//
// Tiến trình này là chỗ đúng để đo, vì nó là tiến trình DUY NHẤT (cùng `tools/neo-so-kiem-toan`)
// liệt kê được MỌI tổ chức qua `public.outbox_danh_sach_to_chuc()`. Mỗi nhịp nó đo từng tổ chức
// trong `withTenant` (`doTonDong` của `@trustprocure/outbox`) rồi ghi ĐÚNG MỘT dòng:
//
//   [unseal-worker] outbox ton dong: <giay> giay, <n> job qua han, <m> to chuc
//
// Metric filter của CloudWatch đọc dòng ấy, nên HÌNH DẠNG của nó là một hợp đồng: ASCII, không
// dấu, ba số nguyên. `dongLogTonDong` là nơi DUY NHẤT dựng nó, và test T1 ghim nguyên văn.
//
// CHIỀU HỎNG ĐƯỢC CHỌN, NÓI RA:
//   • Một tổ chức đo lỗi ⇒ một dòng `khong do duoc` (tên + mã, không giá trị) và đi tiếp; dòng
//     tổng vẫn ghi, `<m>` chỉ đếm tổ chức ĐO ĐƯỢC.
//   • MỌI tổ chức đo lỗi, hay chính lời liệt kê ném ⇒ KHÔNG ghi dòng tổng. Ghi `0 giay` lúc không
//     đo được gì là báo "khoẻ" đúng lúc mù; thiếu điểm dữ liệu thì cảnh báo (missing = breaching)
//     còn thấy được.
//   • Không bao giờ ném ra ngoài: một phép đo phụ không được giết tiến trình mở thầu.
// ==============================================================================================

import type { TonDong } from "@trustprocure/outbox";

/** Tổng hợp qua mọi tổ chức đo được. */
export interface TongTonDong extends TonDong {
  /** Số tổ chức ĐO ĐƯỢC ở nhịp này. */
  readonly soToChuc: number;
}

/** `giay` = MAX qua các tổ chức (job già nhất toàn cụm), `soJob` = TỔNG. */
export function gopTonDong(cac: readonly TonDong[]): TongTonDong {
  let giay = 0;
  let soJob = 0;
  for (const d of cac) {
    if (d.giay > giay) giay = d.giay;
    soJob += d.soJob;
  }
  return { giay, soJob, soToChuc: cac.length };
}

/** Dòng log mà metric filter đọc — xem khối đầu tệp. Đừng đổi chữ nào mà không đổi filter. */
export function dongLogTonDong(t: TongTonDong): string {
  return (
    `[unseal-worker] outbox ton dong: ${String(t.giay)} giay, ${String(t.soJob)} job qua han, ` +
    `${String(t.soToChuc)} to chuc`
  );
}

export interface TuyChonCanhTonDong {
  readonly lietKeToChuc: () => Promise<readonly string[]>;
  /** Đo MỘT tổ chức — bên gọi bọc `withTenant` quanh `doTonDong`. */
  readonly doMotToChuc: (orgId: string) => Promise<TonDong>;
  /** Nhận dòng tổng (đã định dạng). */
  readonly ghi: (dong: string) => void;
  /** Nhận lỗi của lời liệt kê hay của một tổ chức. Bên gọi chịu phần CẤM LOG giá trị. */
  readonly baoLoi: (loi: unknown) => void;
}

/**
 * Một lượt đo. Trả về dòng tổng đã ghi, hay `undefined` khi không ghi (xem khối đầu tệp).
 * Không ném.
 */
export async function doTonDongMotLuot(tc: TuyChonCanhTonDong): Promise<TongTonDong | undefined> {
  let cacToChuc: readonly string[];
  try {
    cacToChuc = await tc.lietKeToChuc();
  } catch (e) {
    tc.baoLoi(e);
    return undefined;
  }
  const doDuoc: TonDong[] = [];
  // TUẦN TỰ, không `Promise.all`: pool này là pool của runner, và một lượt đo không được chiếm
  // mọi kết nối cùng lúc chỉ để trả lời một câu hỏi năm phút một lần.
  for (const orgId of cacToChuc) {
    try {
      doDuoc.push(await tc.doMotToChuc(orgId));
    } catch (e) {
      tc.baoLoi(e);
    }
  }
  if (cacToChuc.length > 0 && doDuoc.length === 0) return undefined;
  const tong = gopTonDong(doDuoc);
  tc.ghi(dongLogTonDong(tong));
  return tong;
}

/**
 * Đo MỘT LẦN sau `treDauMs`, rồi mỗi `chuKyMs`. Trả về hàm dừng: huỷ cả hai hẹn giờ và nuốt kết
 * quả của một lượt đang dở. Cùng khuôn `canhLechDongHoDinhKy` của `@trustprocure/db`: hẹn giờ
 * `unref()` (không giữ tiến trình sống), và một lượt chưa xong thì nhịp sau bỏ qua thay vì chồng.
 */
export function canhTonDongDinhKy(tc: TuyChonCanhTonDong & { readonly chuKyMs: number; readonly treDauMs: number }): () => void {
  let dangDo = false;
  let daDung = false;
  const luot = (): void => {
    if (dangDo || daDung) return;
    dangDo = true;
    void doTonDongMotLuot({
      lietKeToChuc: tc.lietKeToChuc,
      doMotToChuc: tc.doMotToChuc,
      ghi: (d) => {
        if (!daDung) tc.ghi(d);
      },
      baoLoi: (e) => {
        if (!daDung) tc.baoLoi(e);
      },
    })
      // `doTonDongMotLuot` tự bắt lỗi của đo và liệt kê; vế này chỉ đỡ một `ghi`/`baoLoi` ném.
      .catch(() => undefined)
      .finally(() => {
        dangDo = false;
      });
  };
  const dau = setTimeout(luot, tc.treDauMs);
  dau.unref();
  const hen = setInterval(luot, tc.chuKyMs);
  hen.unref();
  return () => {
    daDung = true;
    clearTimeout(dau);
    clearInterval(hen);
  };
}
