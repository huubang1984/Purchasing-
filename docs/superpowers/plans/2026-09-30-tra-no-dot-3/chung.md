# Đợt 3 — đề bài chung cho mọi lô

Đọc cùng đề bài riêng của lô (`<lô>.md` cạnh tệp này) và kế hoạch `../2026-09-30-tra-no-dot-3.md` (mục 0: quyết định của chủ
dự án, đã chốt 2026-09-30). Khuôn là đợt 2: biên bản §S1.214 (người tích hợp) và các biên bản lô §S1.210, §S1.213, §S1.216,
§S1.219, §S1.221, §S1.223 ở `evidence/security-reviews.md`.

## 1. Chỗ làm

- Lô làm trên worktree riêng mà người tích hợp đã dựng, nhánh `dot3/<lô>`. Không `git merge`/`rebase`/`cherry-pick` nhánh nào
  khác, không push, không amend, không `git stash` rồi bỏ; mỗi lô MỘT commit (lượt 2 khi bị trả về: một commit thứ hai).
- Máy dùng chung 4 lõi với ba lô khác. Chỉ chạy cổng của lô (đề bài riêng liệt kê) và các tệp test bạn chạm; KHÔNG chạy
  `pnpm evidence`, `pnpm test:int` trọn hay `db/migrations.int.test.ts` trọn tệp trừ khi đề bài lô cho phép.
- Test tích hợp không có Docker: đặt `TRUSTPROCURE_PG_LOCAL_BIN=/var/lib/postgresql/tp-shim` và
  `TRUSTPROCURE_PG_LOCAL_DATA=/var/lib/postgresql/tp-test` rồi `pnpm vitest run <tệp …>` (mỗi tệp một cụm Postgres 16 riêng —
  `packages/test-support/src/postgres-cuc-bo.ts`). Đơn vị: `pnpm test` hay `pnpm vitest run <tệp>`. Tĩnh: `pnpm t0`.

## 2. Tệp chỉ người tích hợp chạm

`docs/STATE.md`, `docs/DECISIONS.md`, `evidence/security-reviews.md`, `Handoff.md`, `evidence/INV-matrix.md`,
`docs/TEST-PLAN.md`, `tools/inv-matrix/src/so-khai-nhan.ts`, `tools/inv-matrix/src/danh-gia.ts`. Mọi thứ lô muốn ghi vào đó đi
qua tệp bàn giao (mục 5). Một cổng đỏ CHỈ vì phần bàn giao chưa được áp (ví dụ lời khai đếm nhãn `[INV-…]` ở `so-khai-nhan.ts`)
thì ghi rõ ở bàn giao mục 8 — người tích hợp kiểm lại sau khi áp.

Ngoài danh sách tệp của đề bài lô: không sửa. Cần sửa thì dừng phần ấy và ghi vào bàn giao mục 9 (câu hỏi), không đoán.

## 3. Số tạm (ADR-090)

Lô có mã NN (đề bài riêng) và bốn số dự phòng NN+1 … NN+4. Vòng của lô là `S1.91NN` (biên bản `§S1.91NN`, cột mốc
`[2026-09-30 / S1.91NN]`); khoản mới là `94NN`, ADR mới là `ADR-92NN`, migration mới là `95NN_<tên>.sql` — thay NN bằng số của
lô. Chỉ dùng số trong dải của lô. Không đặt tên biến, thẻ dollar-quote, tên tệp hay định danh DÍNH số tạm (`truoc95NN`,
`$doi_chieu_95NN$`, `bang_ma_91NN`): `pnpm cap-so` chỉ thay dạng có tiền tố và dạng trần trong Markdown, còn dạng dính chữ phải
thay tay ở mỗi lần cấp lại. Không chạy `pnpm cap-so` (người tích hợp chạy).

## 4. Quy trình trong lô

1. Đọc hàng sổ nợ của từng khoản ở `docs/STATE.md` §*Nợ kỹ thuật* và biên bản gốc mà hàng dẫn tới.
2. **Đo trước:** mỗi khoản một ca đo ĐỎ trên cây hiện tại, trước khi vá (khoản ghi "ĐỌC" không dựng được ca đỏ thì nói vì sao
   và đo bằng văn bản mẫu/đối chứng). Ghi lệnh và đầu ra.
3. Vá; ca đo xanh; ca cũ liên quan vẫn xanh.
4. **Đột biến:** 3–10 ca cho cả lô, mỗi ca phải đỏ đúng vế (ghi ca sống và lý do đo được).
5. **Lượt tự soi đối kháng:** tìm cách lách bản vá. Lỗ kề nằm ngoài phạm vi thì mở khoản mới `94NN` (rổ đề xuất kèm lý do theo
   ADR-043), KHÔNG vá thêm.
6. Cổng của lô + `pnpm t0` + `pnpm test` xanh (trừ ca đỏ do bàn giao chưa áp — mục 2).
7. Viết tệp bàn giao, rồi commit mã + tệp bàn giao một lần: `S1.91NN: <tóm tắt> — khoản …`, thân nêu số đo, kết thúc bằng
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Quy ước văn bản của kho: tiếng Việt; sửa lời khai cũ bằng GẠCH TẠI CHỖ (`~~cũ~~ **[S1.91NN]** mới`), không xoá lịch sử; mỗi chú
thích mới trong mã mang nhãn `[S1.91NN / khoản N]`.

## 5. Tệp bàn giao

Đường dẫn: `docs/superpowers/plans/2026-09-30-tra-no-dot-3/ban-giao/<lô>.md` (commit cùng lô; người tích hợp áp rồi xoá ở commit
tích hợp). Chín mục, đúng thứ tự, mục không có gì thì ghi "Không có.":

1. **Hàng sổ nợ** — bản MỚI nguyên văn của mỗi hàng đổi (khoản đóng: `**[ĐÓNG]**`, câu tóm tắt `**[S1.91NN — ĐO]** …` đứng đầu,
   phần cũ giữ và gạch theo khuôn hàng 117) và hàng mới `94NN` đủ ba cột. Một hàng một khối ```` ```text ````. Cổng
   `tests/architecture/so-no-tu-doi-chieu.test.ts` (INV-H20) đọc đúng ba cột và giải mọi con trỏ: không `|` trần trong thân (viết `\|`),
   cột ba chỉ đường dẫn ĐẦY ĐỦ từ gốc kho của tệp git theo dõi (`db/migrations/059_vong_bafo.sql`, không `059_vong_bafo.sql`).
2. **Cột mốc** — một đoạn cho `docs/STATE.md` §*Cột mốc hiện tại*, khuôn đoạn `[2026-09-30 / S1.210]`: câu đầu in đậm viết hoa,
   rổ và mảnh `docs/PRODUCT.md` §11 (ADR-043 ⒞), đóng gì, mở gì, trỏ biên bản.
3. **Biên bản** — mục `# §S1.91NN — …` cho `evidence/security-reviews.md`, tám phần như §S1.210: 1. Vòng này là gì · 2. Quyết
   định của chủ dự án · 3. Đo trước · 4. Thay đổi · 5. Điểm tôi tự chốt trong phạm vi đã duyệt · 6. Đột biến · 7. Giới hạn, nói
   ra · 8. Số đo.
4. **ADR mới** — toàn văn `## ADR-92NN — …` (khuôn ADR-124), hay "Không có.".
5. **Điểm tự chốt** — quyết định nhỏ lô tự đưa trong phạm vi đã duyệt, mỗi điểm một lý do đo được.
6. **Sửa tại chỗ ở tệp của người tích hợp** — từng cặp CŨ/MỚI nguyên văn (ADR cũ, mục biên bản cũ, `docs/TEST-PLAN.md`,
   `so-khai-nhan.ts`, `danh-gia.ts`, `Handoff.md`), đủ ngữ cảnh để tìm đúng một chỗ.
7. **Rổ** — khoản đóng (gạch ở dòng RỔ nào), khoản mới vào rổ nào.
8. **Số đo** — lệnh và kết quả (ca đo trước đỏ → sau xanh; đột biến; cổng; `pnpm t0`; `pnpm test`), kể cả ca đỏ vì bàn giao chưa áp.
9. **Câu hỏi cho chủ dự án / người tích hợp** — điều lô không tự quyết (mục 2, mục 6 của đề bài riêng).

## 5b. Luật mới từ lượt A (áp cho lượt B)

- `stop()` của `startPostgres` ném khi số lần `release` mang `SESSION_STATE_LEFT` lệch số khai (mặc định 0 — §S1.242): một test CỐ Ý
  để sót trạng thái phiên khai `soLanSessionStateLeft`; không tắt vế.
- Mã chốt `CONTROL_DENIED` hay mã lý do `RFQ_STATE_DENIED` MỚI phải có tên ở `DANH_MUC_VE_CONG` (`packages/identity/src/rbac.ts`) —
  vế ⑷ của `danh-muc-tu-choi.test.ts` đọc tập khoá ở nguồn (§S1.241).
- `kind` outbox là union `KindOutbox` (`packages/outbox/src/enqueue.ts`), lời gọi `enqueueJob` sản xuất viết `kind` literal; đúng một
  `new JobRunner(…)` mỗi tệp và gương `apps/api/src/test-services.ts` khớp `composition.ts` (§S1.239).
- Đổi hình dạng hằng `VAI_KET_NOI_UNG_DUNG` của hardening (mệnh đề `g.rolname IN (…)`) làm vế ⓷ của
  `db/khoa-ghi-so-nguoi-giu.int.test.ts` ném có tên — sửa `cayTrongHardening` cùng commit (§S1.242).

## 6. Khi bị cắt giữa lô

Hạn mức API (HTTP 429) từng cắt năm agent ở đợt 2. Người tích hợp phóng lại TIẾP NỐI trên chính worktree: đọc `git status` /
`git diff`, giữ phần đúng, làm tiếp — không dựng worktree mới, không làm lại từ đầu.
