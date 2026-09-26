// [ADR-087] Sinh `lambda/canh-dang-ky.mjs` = `src/canh-dang-ky.ts` gỡ kiểu (Node `module.stripTypeScriptTypes`, chế độ
// "strip": chỉ thay kiểu bằng khoảng trắng, giữ nguyên dòng — lỗi trên Lambda chỉ đúng dòng của tệp nguồn).
// `pnpm canh-dang-ky:dong-goi-lambda`; `src/canh-dang-ky.test.ts` đòi tệp sinh ra trùng byte với nguồn hiện tại.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const nguon = new URL("./src/canh-dang-ky.ts", import.meta.url);
const dich = new URL("./lambda/canh-dang-ky.mjs", import.meta.url);
mkdirSync(new URL("./lambda/", import.meta.url), { recursive: true });
writeFileSync(dich, stripTypeScriptTypes(readFileSync(nguon, "utf8"), { mode: "strip" }));
console.error("da ghi tools/canh-dang-ky/lambda/canh-dang-ky.mjs");
