// [ADR-065] Cảnh báo break-glass qua SES: một thư tới danh sách, từ đúng địa chỉ, và NÉM khi SES từ
// chối — hợp đồng "một lần gửi hỏng làm job thất bại và được thử lại". Đo trên SES giả.
import { SendEmailCommand, type SendEmailCommandOutput } from "@aws-sdk/client-sesv2";
import { describe, expect, it } from "vitest";
import { CanhBaoSesError, taoCanhBaoSes, type SesGuiCanhBao } from "./canh-bao-ses.js";

const CANH_BAO = {
  orgId: "11111111-1111-4111-8111-111111111111",
  unsealRequestId: "22222222-2222-4222-8222-222222222222",
  rfqId: "33333333-3333-4333-8333-333333333333",
  severity: "HIGH",
};

describe("[ADR-065] cảnh báo break-glass qua SES", () => {
  it("một SendEmail tới đủ danh sách, từ đúng địa chỉ, mang đủ mã, chữ thuần", async () => {
    const lenh: SendEmailCommand[] = [];
    const client: SesGuiCanhBao = {
      send: (l) => {
        lenh.push(l);
        return Promise.resolve({ $metadata: {} } as SendEmailCommandOutput);
      },
    };
    const sink = taoCanhBaoSes({ client, tuDiaChi: "canh-bao@thu.vidu.vn", denDiaChi: ["a@vidu.vn", "b@vidu.vn"] });
    expect(sink.name).toBe("ses");
    await sink.deliver(CANH_BAO);
    expect(lenh).toHaveLength(1);
    const i = lenh[0]!.input;
    expect(i.FromEmailAddress).toBe("canh-bao@thu.vidu.vn");
    expect(i.Destination?.ToAddresses).toEqual(["a@vidu.vn", "b@vidu.vn"]);
    expect(i.Content?.Simple?.Body?.Html).toBeUndefined();
    const than = i.Content?.Simple?.Body?.Text?.Data ?? "";
    for (const ma of [CANH_BAO.orgId, CANH_BAO.rfqId, CANH_BAO.unsealRequestId, "HIGH"]) expect(than).toContain(ma);
  });

  it("SES từ chối ⇒ deliver NÉM, lỗi gốc ở cause", async () => {
    const goc = new Error("Throttling");
    const sink = taoCanhBaoSes({ client: { send: () => Promise.reject(goc) }, tuDiaChi: "c@thu.vidu.vn", denDiaChi: ["a@vidu.vn"] });
    const loi = await sink.deliver(CANH_BAO).catch((e: unknown) => e);
    expect(loi).toBeInstanceOf(CanhBaoSesError);
    expect((loi as CanhBaoSesError).cause).toBe(goc);
  });

  it("cấu hình sai bị từ chối lúc dựng: không người nhận, quá 50, địa chỉ sai, địa chỉ gửi sai", () => {
    const client: SesGuiCanhBao = { send: () => Promise.resolve({ $metadata: {} }) };
    expect(() => taoCanhBaoSes({ client, tuDiaChi: "c@thu.vidu.vn", denDiaChi: [] })).toThrow(CanhBaoSesError);
    const nam1 = Array.from({ length: 51 }, (_, k) => `n${k}@vidu.vn`);
    expect(() => taoCanhBaoSes({ client, tuDiaChi: "c@thu.vidu.vn", denDiaChi: nam1 })).toThrow(CanhBaoSesError);
    expect(() => taoCanhBaoSes({ client, tuDiaChi: "c@thu.vidu.vn", denDiaChi: ["a@vidu.vn,b@vidu.vn"] })).toThrow(CanhBaoSesError);
    expect(() => taoCanhBaoSes({ client, tuDiaChi: "sai", denDiaChi: ["a@vidu.vn"] })).toThrow(CanhBaoSesError);
  });
});
