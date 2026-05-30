# Implementation Plan

## Phase 1: App foundation

- Tạo workspace mới tách biệt với batch toolkit cũ
- Dựng backend FastAPI + SQLite
- Dựng frontend React + Vite
- Chuẩn hóa schema meeting, transcript, recap

## Phase 2: Transcript integration

- Kết nối backend với script `run_transcribe.sh`
- Tạo output folder riêng cho từng meeting
- Parse `timestamps.txt` thành transcript segments
- Lưu DB và expose API

## Phase 2.5: Web realtime ingest

- Thêm `live session` API
- Thêm WebSocket audio ingest
- Thêm browser capture cho `mic + shared audio`
- Lưu raw PCM trong quá trình ghi
- Khi `stop`, finalize thành wav rồi dùng lại transcript pipeline

## Phase 3: Post-meeting recap

- Tạo recap engine heuristic trước
- Sau đó nâng cấp bằng LLM có structured output
- Export `recap.json` và `recap.md`

## Phase 3.5: Live transcript

- Chia buffer audio theo cửa sổ thời gian
- Chạy ASR snapshot định kỳ
- Gửi partial transcript qua WebSocket
- Sau cùng merge partial và final transcript

## Phase 4: UX

- Sessions list
- Meeting detail
- Transcript viewer
- Recap viewer
- Progress state và actions

## Phase 5: Tauri wrap

- Đóng gói frontend + backend local
- Thêm quyền microphone/file system khi cần capture trực tiếp
