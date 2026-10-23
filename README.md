# Ôn thi AI20K

Trang web tĩnh (HTML/CSS/JS thuần, không cần build) để ôn thi Phase 1 và Phase 2:

- **Ôn theo ngày:** 26 bài, mỗi bài 10 câu trắc nghiệm kèm giải thích.
- **Đề tổng hợp:** 3 đề × 60 câu (50 trắc nghiệm, gồm câu một đáp án và câu nhiều đáp án, cộng 10 câu tự luận có đáp án gợi ý và tự chấm theo ý chính).
- **Hai chế độ:** *Hiện đáp án ngay sau mỗi câu*, hoặc *Làm hết rồi mới chấm* (nộp bài mới hiện đáp án và giải thích).
- **Tiện ích khác:** trộn thứ tự câu, làm lại các câu sai, lưu điểm cao nhất trên trình duyệt, phím tắt (A–E / 1–5 để chọn, Enter, ←/→).

## Chạy thử trên máy

```bash
cd exam-web
python3 -m http.server 8000
# mở http://localhost:8000
```

Cũng có thể mở thẳng `index.html` bằng trình duyệt.

## Deploy

### Vercel
1. Push repo lên GitHub.
2. Trên Vercel chọn **Add New → Project**, import repo.
3. Đặt **Root Directory** = `exam-web`, Framework Preset = **Other**, để trống Build Command, rồi bấm Deploy.

Hoặc dùng CLI: `cd exam-web && npx vercel --prod`.

### GitHub Pages
- **Cách 1 (đã có sẵn workflow):** push cả repo lên GitHub, vào **Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/deploy-exam-web.yml` sẽ tự deploy thư mục `exam-web` mỗi khi nó thay đổi trên nhánh `main`.
- **Cách 2:** tạo repo riêng chỉ chứa nội dung thư mục `exam-web`, rồi vào **Settings → Pages → Deploy from a branch → `main` / root**.

## Sửa hoặc thêm câu hỏi

Dữ liệu trong `data/` được sinh tự động, đừng sửa tay. Hãy sửa nguồn rồi build lại:

| Nguồn | Nội dung |
|---|---|
| `../Phase */md/*.md` | 10 câu trắc nghiệm ở cuối mỗi file tóm tắt (đáp án lấy từ khối "Đáp án") |
| `content/explanations.txt` | Giải thích cho các câu trong md ở trên |
| `content/days_new.txt` | Bộ câu cho những ngày mà md chưa có trắc nghiệm A–D |
| `content/exam1.txt` … `exam3.txt` | Ba đề tổng hợp |

Định dạng của file `content/*.txt`:

```text
Q: Câu hỏi
+ Đáp án đúng (câu nhiều đáp án thì ghi nhiều dòng "+")
- Đáp án sai
E: Giải thích

ESSAY: Câu tự luận
K: Ý chính cần có (dùng cho tự chấm)
M: Một dòng đáp án gợi ý ("M: - ..." sẽ hiển thị thành gạch đầu dòng)
```

Không cần lo vị trí đáp án: script build tự trộn và cân bằng vị trí đáp án đúng. Sau khi sửa, chạy:

```bash
python3 exam-web/tools/build.py
```
