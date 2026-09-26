// ==============================================================================================
// tools/kiem-truoc-apply — KIỂM TRƯỚC `terraform plan/apply` CỦA STACK 90 (`pnpm kiem-truoc-apply --var-file <tệp>`)
//
// Chạy tay trước MỖI lần plan/apply stack 90 (APPLY-LAN-DAU 6.4, 6.6, 8.2). Thoát 1 khi có một dòng [DO]; thoát 2 khi
// không đọc được biến hay không gọi được AWS (hết phiên SSO, thiếu quyền) — không bao giờ in "0 do" khi chưa kiểm xong.
// Tool CHỈ ĐỌC: không đọc giá trị secret, không ghi gì vào AWS hay state.
//
//   --var-file <tệp>     bắt buộc; tương đối theo thư mục đang đứng
//   --profile <tên>      mặc định tp-prod
//   --terraform <lệnh>   mặc định terraform
// ==============================================================================================

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inKetQua, kiemAws, kiemBien } from "./luat.js";
import { congAwsCli, DocBienError, docBienTerraform, TienTrinhError } from "./nguon.js";

const THU_MUC_STACK_90 = fileURLToPath(new URL("../../../infra/terraform/90-ecs", import.meta.url));

async function main(): Promise<number> {
  // `pnpm kiem-truoc-apply -- --var-file …` (thói quen npm) chuyển nguyên `--` sang: bỏ nó, cú pháp nào cũng chạy.
  const thamSo = process.argv.slice(2);
  const { values } = parseArgs({
    args: thamSo[0] === "--" ? thamSo.slice(1) : thamSo,
    options: {
      "var-file": { type: "string" },
      profile: { type: "string", default: "tp-prod" },
      terraform: { type: "string", default: "terraform" },
    },
  });
  const varFile = values["var-file"];
  if (varFile === undefined) {
    console.error("kiem-truoc-apply: thieu --var-file <tep .tfvars cua stack 90>");
    return 2;
  }

  let doc;
  try {
    doc = docBienTerraform(values.terraform, THU_MUC_STACK_90, resolve(varFile));
  } catch (e) {
    if (e instanceof TienTrinhError || e instanceof DocBienError) {
      console.error(`kiem-truoc-apply: khong doc duoc bien qua terraform console (da terraform init trong 90-ecs chua?): ${e.message}`);
      if (e instanceof TienTrinhError && e.stderr !== "") console.error(e.stderr);
      return 2;
    }
    throw e;
  }

  const ketQua = kiemBien(doc.bien, doc.hang);
  try {
    ketQua.push(...(await kiemAws(doc.bien, doc.hang, congAwsCli(values.profile, doc.hang.region))));
  } catch (e) {
    for (const d of inKetQua(ketQua).dong.slice(0, -1)) console.log(d);
    if (e instanceof TienTrinhError) {
      console.error(`kiem-truoc-apply: khong goi duoc AWS voi profile ${values.profile} (aws sso login?): ${e.message}`);
      if (e.stderr !== "") console.error(e.stderr);
      return 2;
    }
    throw e;
  }

  const { dong, soDo } = inKetQua(ketQua);
  for (const d of dong) console.log(d);
  return soDo > 0 ? 1 : 0;
}

process.exitCode = await main();
