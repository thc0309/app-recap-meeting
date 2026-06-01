# Meeting Recap App

Ứng dụng local-first để:

- tạo session meeting
- thu realtime từ microphone + shared system audio trên web
- stream audio về backend local qua WebSocket
- chạy transcript sau khi meeting kết thúc
- xem transcript
- sinh recap
- export recap ra `json` và `md`

## Cấu trúc

- `backend`: FastAPI API + SQLite + pipeline orchestration
- `frontend`: React + Vite UI
- `data`: database và output runtime
- `docs`: tài liệu triển khai

## Luồng hiện tại

### Realtime web capture

1. Bấm `Start live meeting`
2. Browser xin quyền microphone
3. Browser yêu cầu share `tab/window/screen` có bật audio
4. Audio được trộn trên client và stream về backend local
5. Bấm `Stop meeting`
6. Backend chốt file wav, chạy transcript, rồi generate recap

### File-based flow

1. Tạo meeting session
2. Chọn file audio/video ngay trên web UI và upload vào backend local
3. Chạy transcript qua batch engine hiện có
4. Parse transcript segments vào DB
5. Generate recap sau khi meeting xong
6. Xem và export recap

## Luồng MVP ban đầu

- realtime capture da co
- transcript/recap hien tai duoc chot khi stop meeting
- `live transcript tung giay` la phase tiep theo

## Chạy backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```

## Chạy frontend

```bash
cd frontend
npm install
npm run dev
```

## Ghi chú

- Script transcript nằm ngay trong dự án tại:
  - `transcribe/run_transcribe.sh`
  - `transcribe/run_transcribe_with_speakers.sh`
- Mặc định đang đi theo hướng `web local-first`
- Có thể bọc thành `Tauri` ở phase sau mà không phải viết lại backend
- Tren macOS web, `system audio` phu thuoc vao browser share audio capability. Chrome/Chromium la lua chon phu hop nhat.
