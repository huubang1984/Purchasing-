// ==============================================================================================
// apps/mcp/src/khung-dong.ts — GOM BYTE CỦA STDIN THÀNH DÒNG. HÀM THUẦN, KHÔNG CHẠM `process`.
//
// Bốn ca hỏng mà file này tồn tại để chặn — chunk chia đôi thông điệp, hai thông điệp một chunk,
// ký tự UTF-8 bị cắt giữa chunk, dòng khổng lồ — nằm ở khối đầu `khung-dong.test.ts`.
//
// `StringDecoder` chứ không `Buffer.toString()`: nó giữ lại byte lẻ của một ký tự nhiều byte cho
// chunk sau. Đó là khác biệt giữa "chạy được trên máy tôi với dữ liệu ASCII" và "chạy được với
// tên nhà cung cấp tiếng Việt".
// ==============================================================================================

import { StringDecoder } from "node:string_decoder";

/** Trần độ dài MỘT dòng. Một thông điệp MCP dài hơn chừng này là một thông điệp sai. */
export const TRAN_DONG_KY_TU = 1024 * 1024;

export interface BoGomDong {
  nhan(chunk: Buffer): void;
  /**
   * Số ký tự đang nằm trong bộ đệm.
   *
   * [lượt soi 69 M-1] Tồn tại để cái trần ở trên là một PHÉP ĐO chứ không phải một câu trong chú
   * thích: không có nó, "bộ đệm không tích" chỉ kiểm được gián tiếp qua số dòng phát ra — và
   * chính phép kiểm gián tiếp ấy đã để lọt bản đầu, nơi chế độ "bỏ tới hết dòng" tích thay vì bỏ.
   */
  coDem(): number;
}

export interface PhuThuocGom {
  readonly khiCoDong: (dong: string) => void;
  readonly khiQuaTran: (moTa: string) => void;
}

export function taoBoGomDong(pt: PhuThuocGom): BoGomDong {
  const bo = new StringDecoder("utf8");
  let dem = "";
  /** Đang bỏ phần còn lại của một dòng đã vượt trần — xả tới newline kế rồi đọc tiếp. */
  let dangBo = false;

  return {
    coDem: () => dem.length,
    nhan(chunk: Buffer): void {
      dem += bo.write(chunk);
      for (;;) {
        const viTri = dem.indexOf("\n");
        if (viTri === -1) break;
        const dong = dem.slice(0, viTri).replace(/\r$/u, "");
        dem = dem.slice(viTri + 1);
        if (dangBo) {
          dangBo = false;
          continue;
        }
        if (dong.trim().length === 0) continue;
        if (dong.length > TRAN_DONG_KY_TU) {
          pt.khiQuaTran(`dong vuot tran ${String(TRAN_DONG_KY_TU)} ky tu — da bo`);
          continue;
        }
        pt.khiCoDong(dong);
      }
      // [lượt soi 69 M-1] BẢN ĐẦU VIẾT `if (!dangBo && dem.length > TRAN)` VÀ NÓ SAI HẲN CHIỀU:
      // một khi `dangBo` đã bật, điều kiện ấy false vĩnh viễn cho tới khi gặp `\n`, trong khi dòng
      // `dem += bo.write(chunk)` ở trên vẫn nối MỌI chunk vào `dem`. Chế độ "bỏ tới hết dòng" khi
      // ấy không bỏ gì cả — nó TÍCH, và một dòng 4 GB không có newline làm tiến trình OOM. Đúng
      // ca thứ tư mà khối đầu tệp này tuyên bố đã chặn.
      //
      // Đang bỏ thì mọi thứ còn lại trong `dem` đều thuộc dòng bị bỏ — vòng lặp trên đã tiêu thụ
      // hết `\n` — nên xả VÔ ĐIỀU KIỆN.
      if (dangBo) {
        dem = "";
      } else if (dem.length > TRAN_DONG_KY_TU) {
        pt.khiQuaTran(`dong vuot tran ${String(TRAN_DONG_KY_TU)} ky tu — dang bo toi het dong`);
        dem = "";
        dangBo = true;
      }
    },
  };
}
