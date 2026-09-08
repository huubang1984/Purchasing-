// ==============================================================================================
// [khoản nợ 59] MỘT KHOÁ LIÊN TIẾN TRÌNH CHO `depcruise` — VÌ CÂY NGUỒN LÀ TÀI NGUYÊN DÙNG CHUNG
//
// Khoản nợ 59, nguyên văn: khẳng định *"mã nguồn hiện tại không vi phạm quy tắc nào"* KHÔNG
// hermetic. `apps/api/src/routes.test.ts` viết một probe THẬT vào `apps/api/src/routes/` rồi chạy
// `depcruise` trên `apps/api`; `tests/architecture/boundaries.test.ts` chạy `pnpm run depcruise`
// trên TOÀN kho. Hai tệp khác nhau ⇒ vitest chạy chúng ở hai tiến trình song song ⇒ lượt quét
// toàn kho nhìn thấy probe của tệp kia và báo một vi phạm KHÔNG CÓ THẬT.
//
// Đó là một cổng ĐỎ GIẢ, và một cổng đỏ giả là cổng người ta học cách chạy lại thay vì đọc.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO LÀ KHOÁ, KHÔNG PHẢI MỘT PHÉP LOẠI TRỪ THEO TÊN
// ----------------------------------------------------------------------------------------------
// Đường dễ hơn là cho `pnpm run depcruise` bỏ qua mọi tệp tên `zprobe-*`. Nó đóng được đua tranh,
// nhưng đổi lại: cổng sản xuất thôi nhìn một lớp tệp mà chỉ một quy ước đặt tên giữ cho trống —
// tức mua sự yên tĩnh bằng một lỗ. Khoá thì không đổi thứ gì được đo; nó chỉ nói *"đừng đo trong
// lúc người khác đang sửa cây nguồn"*.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO KHOÁ ĐỒNG BỘ, VÀ VÌ SAO `mkdir`
// ----------------------------------------------------------------------------------------------
// Cả hai chỗ gọi đều dùng `spawnSync`, nên khoá bất đồng bộ sẽ phải đổi hình cả hai lời gọi mà
// không mua thêm gì. `mkdir` là thao tác NGUYÊN TỬ trên cả POSIX lẫn Windows: hai tiến trình cùng
// gọi thì đúng một cái thành công — khác với `existsSync` rồi `mkdir`, cặp đôi có cửa sổ ở giữa.
//
// Khoá CÓ HẠN theo hai chiều: chờ tối đa `HAN_CHO_MS` rồi NÉM (một lượt treo im lặng còn tệ hơn
// một lượt đỏ), và một khoá cũ hơn `HAN_KHOA_MS` bị coi là rác của một tiến trình đã chết.
// ==============================================================================================

import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/** Khoá nằm ngoài cây nguồn: một thư mục trong cây sẽ tự nó thành thứ `depcruise` nhìn thấy. */
const DUONG_KHOA = join(tmpdir(), `trustprocure-depcruise-${Buffer.from(GOC).toString("hex").slice(-24)}`);

const HAN_CHO_MS = 180_000;
const HAN_KHOA_MS = 300_000;
const NHIP_MS = 50;

/** Ngủ ĐỒNG BỘ — `Atomics.wait` là cách duy nhất làm việc đó mà không quay vòng đốt CPU. */
function nguDongBo(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Chạy `fn` với khoá `depcruise` trong tay. Mọi lời gọi `depcruise` đọc CÂY NGUỒN phải đi qua đây.
 */
export function voiKhoaDepcruise<T>(fn: () => T): T {
  const han = Date.now() + HAN_CHO_MS;
  for (;;) {
    try {
      mkdirSync(DUONG_KHOA);
      break;
    } catch {
      // Khoá của một tiến trình đã chết không được giữ cây nguồn làm con tin mãi mãi.
      try {
        if (Date.now() - statSync(DUONG_KHOA).mtimeMs > HAN_KHOA_MS) {
          rmSync(DUONG_KHOA, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // khoá vừa biến mất giữa chừng — thử lại ngay
      }
      if (Date.now() > han) {
        throw new Error(
          `[khoản nợ 59] chờ khoá depcruise quá ${HAN_CHO_MS} ms tại ${DUONG_KHOA}. ` +
            "Một lượt treo im lặng còn tệ hơn một lượt đỏ, nên chỗ này NÉM.",
        );
      }
      nguDongBo(NHIP_MS);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(DUONG_KHOA, { recursive: true, force: true });
  }
}

/** Chỉ dùng cho phép đo về CHÍNH khoá này — xem `khoa-depcruise.test.ts`. */
export const DUONG_KHOA_DE_DO = DUONG_KHOA;
