import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  JobRunner,
  MAX_ATTEMPTS_LIMIT,
  MAX_BATCH_SIZE,
  MAX_HANDLER_TIMEOUT_MS,
  MAX_LEASE_SECONDS,
  MAX_POLL_INTERVAL_MS,
  MAX_RETRY_DELAY_SECONDS,
  MIN_POLL_INTERVAL_MS,
  OutboxError,
} from "./index.js";

// ============================================================================================
// Phép kiểm mặt tiền, KHÔNG cần Postgres. Chúng nằm ở tầng `pnpm test` có chủ đích: một tham số
// vượt trần phải bị chặn TRƯỚC khi có kết nối nào được mở.
//
// Bài học nguồn (Task 9 §I4, đo được): `window` và `maxFailedAttempts` do người gọi truyền mà
// KHÔNG CÓ CẬN TRÊN biến một bảo đảm an ninh thành vô nghĩa — `window = 200000` làm một mã TOTP
// 30 PHÚT TUỔI được chấp nhận và đốt 8,7 giây CPU trong MỘT lời gọi. Ở đây cái mất nhẹ hơn
// nhiều, nhưng khuôn thì y hệt, nên trần được GHIM (QT2) thay vì được hy vọng.
// ============================================================================================

// Pool giả: mọi test dưới đây phải nổ TRƯỚC khi chạm tới nó. Nếu một ngày phép kiểm bị dời
// xuống sau lời gọi CSDL, `connect`/`query` ném và test đỏ với thông điệp nói đúng điều đó —
// đó là vế chống rỗng ruột của cả nhóm, không phải một tiện tay.
const POOL_KHONG_DUOC_DUNG = {
  connect(): never {
    throw new Error("POOL BỊ CHẠM: phép kiểm tham số đã chạy SAU khi mở kết nối.");
  },
  query(): never {
    throw new Error("POOL BỊ CHẠM: phép kiểm tham số đã chạy SAU khi mở kết nối.");
  },
} as unknown as pg.Pool;

describe("trần tham số của JobRunner", () => {
  it("batchSize vượt trần bị từ chối, và trần đúng bằng hằng công khai", () => {
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { batchSize: MAX_BATCH_SIZE + 1 })).toThrow(
      RangeError,
    );
    // Vế chống rỗng ruột: đúng trần thì PHẢI qua, nếu không test trên xanh vì mọi giá trị đều bị
    // chặn chứ không vì cái trần được canh.
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { batchSize: MAX_BATCH_SIZE }),
    ).not.toThrow();
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { batchSize: 0 })).toThrow(RangeError);
  });

  it("maxAttempts, retryDelaySeconds, leaseSeconds đều có cả hai cận", () => {
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { maxAttempts: MAX_ATTEMPTS_LIMIT + 1 }),
    ).toThrow(RangeError);
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { maxAttempts: 0 })).toThrow(RangeError);
    expect(
      () =>
        new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { retryDelaySeconds: MAX_RETRY_DELAY_SECONDS + 1 }),
    ).toThrow(RangeError);
    // 0 giây là HỢP LỆ cho retryDelaySeconds — thử lại ngay là một lựa chọn thật, khác với
    // batchSize = 0 (một lô rỗng không có nghĩa gì).
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { retryDelaySeconds: 0 })).not.toThrow();
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { leaseSeconds: MAX_LEASE_SECONDS + 1 }),
    ).toThrow(RangeError);
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { leaseSeconds: 0 })).toThrow(RangeError);
  });

  it("[vòng fix 1 — MỤC 3] handlerTimeoutMs bị CHẶN TRÊN bởi chính leaseSeconds", () => {
    // Trần này KHÔNG phải một con số chính sách như các trần khác: nó là hệ quả ngữ nghĩa. Một
    // handler chạy quá hạn thuê sẽ thấy job của mình đã bị runner khác claim lại, nên câu ghi
    // kết cục của nó chạm 0 hàng — kết cục ấy đằng nào cũng bị từ chối. Cho phép trần lớn hơn
    // hạn thuê chỉ mua thêm thời gian chờ một kết quả không ai công nhận.
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { leaseSeconds: 2, handlerTimeoutMs: 2001 }),
    ).toThrow(RangeError);
    // Vế chống rỗng ruột: ĐÚNG trần thì PHẢI qua.
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { leaseSeconds: 2, handlerTimeoutMs: 2000 }),
    ).not.toThrow();
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { handlerTimeoutMs: 0 }),
    ).toThrow(RangeError);
    // Và trần TUYỆT ĐỐI công bố ở mặt tiền phải khớp với trần thật khi leaseSeconds lớn nhất —
    // nếu không, hằng xuất ra cửa là một con số nói dối.
    expect(MAX_HANDLER_TIMEOUT_MS).toBe(MAX_LEASE_SECONDS * 1000);
    expect(
      () =>
        new JobRunner(
          POOL_KHONG_DUOC_DUNG,
          {},
          { leaseSeconds: MAX_LEASE_SECONDS, handlerTimeoutMs: MAX_HANDLER_TIMEOUT_MS },
        ),
    ).not.toThrow();
  });

  it("pollIntervalMs có cận DƯỚI — một vòng poll 0ms là một vòng bận", () => {
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { pollIntervalMs: MIN_POLL_INTERVAL_MS - 1 }),
    ).toThrow(RangeError);
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { pollIntervalMs: MAX_POLL_INTERVAL_MS + 1 }),
    ).toThrow(RangeError);
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { pollIntervalMs: MIN_POLL_INTERVAL_MS }),
    ).not.toThrow();
  });

  it("số không nguyên bị từ chối — 0,5 lô hay 1,5 lần thử không có nghĩa", () => {
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { batchSize: 1.5 })).toThrow(RangeError);
    expect(() => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { maxAttempts: Number.NaN })).toThrow(
      RangeError,
    );
    expect(
      () => new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { leaseSeconds: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe("runOnce() đòi nguồn danh sách tổ chức", () => {
  it("thiếu listOrganizations thì NÉM, không âm thầm chạy 0 tổ chức", async () => {
    // Đây là vế fail-closed của quyết định "không dùng role vượt RLS": runner KHÔNG tự đọc được
    // danh sách tổ chức, nên nếu không ai tiêm nguồn vào thì nó phải NÓI RA. Trả 0 lặng lẽ là
    // đúng khuôn "fail-open, im lặng" — một hàng đợi không chạy gì mà không ai thấy gì đỏ.
    const runner = new JobRunner(POOL_KHONG_DUOC_DUNG, {});
    await expect(runner.runOnce()).rejects.toBeInstanceOf(OutboxError);
    await expect(runner.runOnce()).rejects.toThrow(/listOrganizations/);
  });

  it("có listOrganizations rỗng thì trả 0 và KHÔNG chạm pool — đối chứng dương", async () => {
    const runner = new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { listOrganizations: () => [] });
    await expect(runner.runOnce()).resolves.toBe(0);
  });
});

describe("[S1.81 / khoản 116] mảng lọc `kind` rỗng thì NÉM, không báo 0 job mãi mãi", () => {
  // Từ S1.81 `CAU_CLAIM` mang `j.kind = ANY($4)`. `= ANY('{}'::text[])` là FALSE với MỌI hàng,
  // nên một runner không handler và không khai `kindKhongNguoiNhan` sẽ trả "0 job" đều đặn trong
  // khi hàng đợi đầy — một hỏng hóc IM LẶNG trông y hệt một hàng đợi rỗng. Cùng lập luận
  // fail-closed đã ép `listOrganizations` phải ném.
  it("runOnceForOrg NÉM, và ném TRƯỚC khi mượn kết nối", async () => {
    const runner = new JobRunner(POOL_KHONG_DUOC_DUNG, {});
    await expect(runner.runOnceForOrg("11111111-1111-4111-8111-111111111111")).rejects.toBeInstanceOf(
      OutboxError,
    );
    await expect(runner.runOnceForOrg("11111111-1111-4111-8111-111111111111")).rejects.toThrow(/kind/);
  });

  it("runOnce NÉM khi danh sách tổ chức KHÔNG rỗng", async () => {
    const runner = new JobRunner(POOL_KHONG_DUOC_DUNG, {}, {
      listOrganizations: () => ["11111111-1111-4111-8111-111111111111"],
    });
    await expect(runner.runOnce()).rejects.toThrow(/kind/);
  });

  it("đối chứng dương: `kindKhongNguoiNhan` một mình đủ để ĐI QUA phép kiểm và chạm pool", async () => {
    // Không có vế này, hai test trên xanh cả khi phép kiểm ném VÔ ĐIỀU KIỆN. Đây là hình dạng
    // thật của tiến trình khai sổ mồ côi: bảng handler có thể không chứa `kind` ấy, nhưng mảng
    // lọc thì có — nên lượt chạy phải đi tiếp tới CSDL và nổ ở đó, không nổ ở phép kiểm.
    const runner = new JobRunner(POOL_KHONG_DUOC_DUNG, {}, { kindKhongNguoiNhan: ["MO_COI"] });
    await expect(
      runner.runOnceForOrg("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(/POOL BỊ CHẠM/);
  });
});
