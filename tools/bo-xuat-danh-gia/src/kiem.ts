// ==============================================================================================
// [S1.114 / S2.7 / ADR-059] KIỂM MỘT BỘ BẰNG CHỨNG — HAI LỚP, HAI CHỦ THỂ
//
// ----------------------------------------------------------------------------------------------
// HAI LỚP, VÀ VÌ SAO BẢO ĐẢM KHÔNG TREO VÀO LỚP RẺ
// ----------------------------------------------------------------------------------------------
// ⑴ **Lớp gọi hàm thuần** — gọi `tinhChiPhiHieuDung` của `@trustprocure/danh-gia`. Rẻ, chạy mỗi
//    lượt, bắt hồi quy sớm. Nó chứng *bundle nhất quán với mã hôm nay*.
// ⑵ **Lớp độc lập** — `./kiem-doc-lap.ts`, viết từ `DAC-TA.md`, phương pháp khác, không import một
//    symbol nào của `@trustprocure/danh-gia`. Nó chứng *con số ĐÚNG theo đặc tả*.
//
// Một lỗi NẰM TRONG `chiPhiHieuDung` tự tái lập chính nó qua lớp ⑴: lượt chấm ghi số sai, lớp ⑴
// tính lại bằng chính hàm sai ấy và thấy khớp. Đó không phải một khả năng lý thuyết — nó là lý do
// ADR-059 tồn tại. Nên:
//
//   * **kết luận của bundle là kết luận của lớp ⑵**;
//   * khi hai lớp BẤT ĐỒNG, lượt kiểm ĐỎ và nói ra rằng hai lớp bất đồng — một trong hai đang sai,
//     và im lặng chọn một bên là đúng thứ lớp này sinh ra để không làm.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO LỚP ⑴ LÀ MỘT THAM SỐ TIÊM ĐƯỢC
// ----------------------------------------------------------------------------------------------
// Mặc định là hàm thật. Tham số tồn tại để ĐO được mệnh đề ở trên: một phép đo cần dựng được một
// thế giới trong đó `chiPhiHieuDung` có lỗi làm tròn, rồi cho thấy lớp ⑴ nói ĐẠT còn lớp ⑵ nói
// LỆCH. Không có điểm tiêm thì câu ấy chỉ là một câu trong tài liệu — và ADR-059 §*Đo bằng gì* ⒞
// đòi nó là một phép đo.
//
// ----------------------------------------------------------------------------------------------
// HÀNG KHÔNG TÁI LẬP ĐƯỢC LÀ MỘT KẾT LUẬN, KHÔNG PHẢI MỘT LẦN BỎ QUA
// ----------------------------------------------------------------------------------------------
// `057` chỉ đòi `ma` và `tien` trong `components`, nên một hàng thiếu `giaTri` hợp lệ với cơ sở dữ
// liệu mà không tái lập được. Nó được đếm RIÊNG, và một bundle mà KHÔNG hàng nào tái lập được thì
// **không ĐẠT** — `every()` trên mảng rỗng in ✓, và một lớp bằng chứng in ✓ trên không phép đo nào
// là thứ tệ hơn cả không có lớp nào.
// ==============================================================================================

import {
  laTuChoi,
  tinhChiPhiHieuDung,
  type ThanhPhanChinhSach,
} from "@trustprocure/danh-gia";
import { DAC_TA } from "./dac-ta.js";
import {
  khongTinhDuoc,
  tinhLai,
  xepHangLai,
  type KetQuaTinhLai,
  type KhongTinhDuoc,
  type ThanhPhanChinhSachDoc,
} from "./doc-lap/tinh-lai.js";
import type { BoBangChung, HangBundle, LuotChamBundle } from "./bo.js";

/** Chữ ký của lớp ⑴. Mặc định bọc `tinhChiPhiHieuDung`; test tiêm một bản CÓ LỖI vào đây. */
export type TinhHamThuan = (
  chinhSach: readonly ThanhPhanChinhSachDoc[],
  dauVao: readonly { readonly ma: string; readonly giaTri: string }[],
) => KetQuaTinhLai | KhongTinhDuoc;

/**
 * Bản mặc định: đổi cách viết khoá rồi giao cho `@trustprocure/danh-gia`.
 *
 * `don_vi` lạ được TỪ CHỐI ở đây chứ không ép về `TIEN`. Ép sẽ làm hai lớp bất đồng trên một
 * bundle mà cả hai đều đọc được — và một lời báo *"hai lớp bất đồng"* sai chỗ làm mòn đúng tín
 * hiệu mà ADR-059 dựng lớp ⑵ để phát.
 */
export const HAM_THUAN_THAT: TinhHamThuan = (chinhSach, dauVao) => {
  const cs: ThanhPhanChinhSach[] = [];
  for (const c of chinhSach) {
    if (c.don_vi !== "TIEN" && c.don_vi !== "DIEM") return { lyDo: "DON_VI_LA", ma: c.ma };
    cs.push({ ma: c.ma, donVi: c.don_vi, heSo: c.he_so });
  }
  const kq = tinhChiPhiHieuDung(cs, [...dauVao]);
  if (laTuChoi(kq)) return { lyDo: kq.lyDo, ma: kq.ma };
  return {
    effectiveCost: kq.effectiveCost,
    components: kq.components.map((c) => ({ ma: c.ma, donVi: c.donVi, tien: c.tien })),
  };
};

export type KetLuanHang = "DAT" | "LECH" | "KHONG_TAI_LAP_DUOC";

export interface KiemHang {
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly ketLuan: KetLuanHang;
  /** Mỗi dòng gọi tên ĐÚNG chỗ lệch. Rỗng khi `DAT`. */
  readonly noi: readonly string[];
}

export interface KetQuaKiem {
  readonly dat: boolean;
  readonly soHang: number;
  readonly soDat: number;
  readonly soLech: number;
  readonly soKhongTaiLapDuoc: number;
  readonly hang: readonly KiemHang[];
  /** Lệch ở mức bundle: băm đặc tả, thứ hạng, trao thầu. */
  readonly loiBo: readonly string[];
  /** Hạng của báo giá được trao thầu — BÁO, không phán xử. Xem `DAC-TA.md` §7. */
  readonly hangTraoThau: readonly { readonly awardId: string; readonly rank: number | null }[];
}

/** Đầu vào của phép tính lại cho một hàng: `ma` + `giaTri` đã lưu, KHÔNG lấy `tien` hay `heSo`. */
function dauVaoCuaHang(hang: HangBundle): readonly { ma: string; giaTri: string }[] | null {
  const ra: { ma: string; giaTri: string }[] = [];
  for (const c of hang.components) {
    if (c.giaTri === undefined) return null;
    ra.push({ ma: c.ma, giaTri: c.giaTri });
  }
  return ra;
}

function soSanhKetQua(
  nhan: string,
  kq: KetQuaTinhLai | KhongTinhDuoc,
  hang: HangBundle,
): readonly string[] {
  if (khongTinhDuoc(kq)) {
    return [`${nhan}: không tính lại được (${kq.lyDo}${kq.ma === undefined ? "" : ` tại "${kq.ma}"`})`];
  }
  const noi: string[] = [];
  if (kq.effectiveCost !== hang.effectiveCost) {
    noi.push(
      `${nhan}: effectiveCost đã lưu ${String(hang.effectiveCost)}, tính lại ra ${kq.effectiveCost}`,
    );
  }
  const luu = new Map(hang.components.map((c) => [c.ma, c.tien]));
  for (const c of kq.components) {
    if (!luu.has(c.ma)) {
      noi.push(`${nhan}: chính sách khai thành phần "${c.ma}" mà hàng không có`);
      continue;
    }
    const t = luu.get(c.ma) ?? null;
    if (t !== c.tien) {
      noi.push(`${nhan}: thành phần "${c.ma}" đã lưu ${String(t)}, tính lại ra ${String(c.tien)}`);
    }
  }
  for (const ma of luu.keys()) {
    if (!kq.components.some((c) => c.ma === ma)) {
      noi.push(`${nhan}: hàng mang thành phần "${ma}" mà chính sách không khai`);
    }
  }
  return noi;
}

function kiemMotHang(luot: LuotChamBundle, hang: HangBundle, hamThuan: TinhHamThuan): KiemHang {
  const chung = { evaluationId: luot.evaluationId, bidVersionId: hang.bidVersionId };
  const dauVao = dauVaoCuaHang(hang);
  if (dauVao === null || hang.effectiveCost === null) {
    return {
      ...chung,
      ketLuan: "KHONG_TAI_LAP_DUOC",
      noi: [
        dauVao === null
          ? "một thành phần thiếu `giaTri` — `057` không cưỡng chế trường ấy, nên hàng này hợp lệ với CSDL mà không tái lập được"
          : "hàng không khai `effectiveCost` — bundle nói báo giá này không có số tiền đọc được, và đó là một mệnh đề bộ kiểm KHÔNG xác nhận cũng KHÔNG bác được từ bundle; `057` cho phép hình dạng ấy, nên nó được đếm riêng chứ không được đếm là ĐẠT",
      ],
    };
  }

  // Lớp ⑵ — CHỦ THỂ của bảo đảm.
  const docLap = soSanhKetQua("lớp độc lập", tinhLai(luot.chinhSachThanhPhan, dauVao), hang);
  // Lớp ⑴ — rẻ, và nó còn để bắt chính nó bất đồng với lớp ⑵.
  const thuan = soSanhKetQua("lớp hàm thuần", hamThuan(luot.chinhSachThanhPhan, dauVao), hang);

  const noi = [...docLap, ...thuan];
  if (docLap.length === 0 && thuan.length > 0) {
    noi.push(
      "HAI LỚP BẤT ĐỒNG: lớp độc lập nói ĐẠT, lớp hàm thuần nói LỆCH — một trong hai bản cài đang sai",
    );
  }
  if (docLap.length > 0 && thuan.length === 0) {
    noi.push(
      "HAI LỚP BẤT ĐỒNG: lớp hàm thuần nói ĐẠT, lớp độc lập nói LỆCH — đây là hình dạng của một lỗi NẰM TRONG `chiPhiHieuDung` (ADR-059)",
    );
  }
  return { ...chung, ketLuan: noi.length === 0 ? "DAT" : "LECH", noi };
}

function kiemThuHang(luot: LuotChamBundle): readonly string[] {
  const tinh = xepHangLai(luot.hang.map((h) => h.effectiveCost));
  const noi: string[] = [];
  luot.hang.forEach((h, i) => {
    const t = tinh[i] ?? null;
    if (t !== h.rank) {
      noi.push(
        `lượt chấm ${luot.evaluationId}: hàng ${h.bidVersionId} đã lưu hạng ${String(h.rank)}, tính lại ra ${String(t)}`,
      );
    }
  });
  return noi;
}

/**
 * Kiểm một bộ bằng chứng. Hàm THUẦN: không đọc CSDL, không đọc đồng hồ, không đọc đĩa.
 *
 * `dacTaDiKem` là ĐÚNG byte của `DAC-TA.md` nằm trong bundle, đã đọc sẵn — băm nó là việc của chỗ
 * gọi (nó có `node:crypto`; hàm này cố ý không có).
 */
export function kiemBo(
  bo: BoBangChung,
  dacTaDiKem: string,
  hamThuan: TinhHamThuan = HAM_THUAN_THAT,
): KetQuaKiem {
  const loiBo: string[] = [];

  // ⑴ Đặc tả đi kèm phải là đặc tả bộ kiểm này biết. Một bundle mang một luật KHÁC thì kết luận
  //    của lượt kiểm này không nói gì về nó.
  if (dacTaDiKem !== DAC_TA) {
    loiBo.push(
      `${"DAC-TA.md"} đi kèm KHÁC đặc tả bộ kiểm này cài — kết luận dưới đây không áp cho bundle này`,
    );
  }

  const hang: KiemHang[] = [];
  for (const luot of bo.luotCham) {
    for (const h of luot.hang) hang.push(kiemMotHang(luot, h, hamThuan));
    loiBo.push(...kiemThuHang(luot));
  }

  // ⑵ Trao thầu phải nối được với một hàng của một lượt chấm CÓ TRONG bundle.
  const hangTraoThau: { awardId: string; rank: number | null }[] = [];
  for (const t of bo.traoThau) {
    const luot = bo.luotCham.find((l) => l.evaluationId === t.evaluationId);
    if (luot === undefined) {
      loiBo.push(`trao thầu ${t.awardId} trỏ lượt chấm ${t.evaluationId} KHÔNG có trong bundle`);
      continue;
    }
    const h = luot.hang.find((x) => x.bidVersionId === t.bidVersionId);
    if (h === undefined) {
      loiBo.push(
        `trao thầu ${t.awardId} trỏ báo giá ${t.bidVersionId} không có trong bảng xếp hạng của lượt chấm ấy`,
      );
      continue;
    }
    hangTraoThau.push({ awardId: t.awardId, rank: h.rank });
  }

  const soDat = hang.filter((h) => h.ketLuan === "DAT").length;
  const soLech = hang.filter((h) => h.ketLuan === "LECH").length;
  const soKhongTaiLapDuoc = hang.filter((h) => h.ketLuan === "KHONG_TAI_LAP_DUOC").length;
  if (soDat === 0) {
    loiBo.push(
      `KHÔNG một hàng nào tái lập được (${String(hang.length)} hàng) — một lượt kiểm không đo được gì thì không ĐẠT`,
    );
  }
  return {
    dat: loiBo.length === 0 && soLech === 0 && soDat > 0,
    soHang: hang.length,
    soDat,
    soLech,
    soKhongTaiLapDuoc,
    hang,
    loiBo,
    hangTraoThau,
  };
}
