// [ADR-087] Canh đăng ký SNS — đối chiếu trên một SNS giả, và tệp Lambda trùng byte với nguồn gỡ kiểu.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import type { ListSubscriptionsByTopicCommand, ListSubscriptionsByTopicCommandOutput } from "@aws-sdk/client-sns";
import { describe, expect, it } from "vitest";
import { docMongDoi, doiChieu, dongLog, kiemDangKy, lietKeDangKy, type DangKy, type SnsChiDoc } from "./canh-dang-ky.js";

const KHOA = "arn:aws:sns:ap-southeast-1:528657840905:tp-canh-bao-khoa";
const VAN_HANH = "arn:aws:sns:ap-southeast-1:528657840905:tp-canh-bao-van-hanh";

interface DangKyGia {
  readonly topic: string;
  readonly giaoThuc?: string;
  readonly diem: string;
  readonly xacNhan: boolean;
}

/** SNS giả: ListSubscriptionsByTopic với phân trang cỡ `trang`. */
function snsGia(ds: readonly DangKyGia[], trang = 100): SnsChiDoc {
  return {
    send(lenh: ListSubscriptionsByTopicCommand): Promise<ListSubscriptionsByTopicCommandOutput> {
      const cua = ds.filter((d) => d.topic === lenh.input.TopicArn);
      const batDau = Number(lenh.input.NextToken ?? "0");
      const phan = cua.slice(batDau, batDau + trang);
      return Promise.resolve({
        $metadata: {},
        Subscriptions: phan.map((d, i) => ({
          TopicArn: d.topic,
          Protocol: d.giaoThuc ?? "email",
          Endpoint: d.diem,
          SubscriptionArn: d.xacNhan ? `${d.topic}:${String(batDau + i)}` : "PendingConfirmation",
        })),
        NextToken: batDau + trang < cua.length ? String(batDau + trang) : undefined,
      });
    },
  };
}

const dk = (diem: string, daXacNhan = true, giaoThuc = "email"): DangKy => ({ giaoThuc, diem, daXacNhan });

describe("[ADR-087] đối chiếu đăng ký với danh sách Terraform", () => {
  it("mọi địa chỉ đã xác nhận ⇒ không hỏng; so địa chỉ không phân biệt hoa thường", () => {
    const kq = doiChieu({ topic: KHOA, bien: "email_canh_bao", nhan: ["An@Thu-Mua.vn"] }, [dk("an@thu-mua.vn")]);
    expect(kq.hong).toEqual([]);
  });

  it("chờ xác nhận, không có, lạ — mỗi ca một mục, đúng vị trí trong biến", () => {
    const kq = doiChieu({ topic: VAN_HANH, bien: "email_van_hanh", nhan: ["a@x.vn", "b@x.vn", "c@x.vn"] }, [
      dk("a@x.vn"),
      dk("b@x.vn", false),
      dk("ke-la@y.vn"),
      dk("https://hook.y.vn", true, "https"),
    ]);
    expect(kq.hong).toEqual([
      { loai: "cho xac nhan", bien: "email_van_hanh", viTri: 1 },
      { loai: "khong co", bien: "email_van_hanh", viTri: 2 },
      { loai: "la", giaoThuc: "email" },
      { loai: "la", giaoThuc: "https" },
    ]);
  });

  it("một bản đã xác nhận cạnh một bản chờ của cùng địa chỉ ⇒ không hỏng", () => {
    expect(doiChieu({ topic: KHOA, bien: "email_canh_bao", nhan: ["a@x.vn"] }, [dk("a@x.vn", false), dk("a@x.vn")]).hong).toEqual([]);
  });

  it("dòng log: không in địa chỉ; mỗi hỏng một dòng DANG KY HONG; dòng tổng cuối", () => {
    const dong = dongLog([
      doiChieu({ topic: KHOA, bien: "email_canh_bao", nhan: ["an@x.vn"] }, [dk("an@x.vn", false)]),
      doiChieu({ topic: VAN_HANH, bien: "email_van_hanh", nhan: ["b@x.vn"] }, [dk("b@x.vn"), dk("la@x.vn")]),
    ]);
    expect(dong).toEqual([
      "canh-dang-ky: tp-canh-bao-khoa email_canh_bao[0] DANG KY HONG: cho xac nhan",
      "canh-dang-ky: tp-canh-bao-van-hanh DANG KY HONG: la (giao thuc email)",
      "canh-dang-ky: 2 topic, 2 dia chi, 2 hong",
    ]);
    expect(dong.join("\n")).not.toMatch(/@/u);
  });

  it("phân trang và hai topic qua SNS giả", async () => {
    const ds: DangKyGia[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ topic: VAN_HANH, diem: `n${String(i)}@x.vn`, xacNhan: true })),
      { topic: KHOA, diem: "an@x.vn", xacNhan: false },
    ];
    expect(await lietKeDangKy(snsGia(ds, 2), VAN_HANH)).toHaveLength(5);
    const kq = await kiemDangKy(snsGia(ds, 2), [
      { topic: KHOA, bien: "email_canh_bao", nhan: ["an@x.vn"] },
      { topic: VAN_HANH, bien: "email_van_hanh", nhan: ds.filter((d) => d.topic === VAN_HANH).map((d) => d.diem) },
    ]);
    expect(kq.map((k) => k.hong.length)).toEqual([1, 0]);
  });

  it("MONG_DOI: đúng dạng thì đọc; thiếu, rỗng, sai ARN, thiếu người nhận ⇒ ném", () => {
    expect(docMongDoi(JSON.stringify([{ topic: KHOA, bien: "email_canh_bao", nhan: ["a@x.vn"] }]))).toEqual([
      { topic: KHOA, bien: "email_canh_bao", nhan: ["a@x.vn"] },
    ]);
    for (const sai of [
      undefined,
      "",
      "[]",
      "{}",
      JSON.stringify([{ topic: "tp-canh-bao-khoa", bien: "b", nhan: ["a@x.vn"] }]),
      JSON.stringify([{ topic: KHOA, bien: "", nhan: ["a@x.vn"] }]),
      JSON.stringify([{ topic: KHOA, bien: "b", nhan: [] }]),
      JSON.stringify([{ topic: KHOA, bien: "b", nhan: ["khong-phai-thu"] }]),
    ]) {
      expect(() => docMongDoi(sai), String(sai)).toThrow();
    }
  });

  it("lambda/canh-dang-ky.mjs trùng byte với nguồn gỡ kiểu — chạy `pnpm canh-dang-ky:dong-goi-lambda` nếu đỏ", () => {
    const nguon = readFileSync(new URL("./canh-dang-ky.ts", import.meta.url), "utf8");
    const lambda = readFileSync(new URL("../lambda/canh-dang-ky.mjs", import.meta.url), "utf8");
    expect(lambda).toBe(stripTypeScriptTypes(nguon, { mode: "strip" }));
  });
});
