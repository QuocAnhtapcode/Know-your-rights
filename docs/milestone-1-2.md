# Biên bản mốc 1–2 — Know Your Rights v4 Firebase

Ngày xác minh: **13/09/2026**  
Project duy nhất: **`know-your-rights-cd8b5`**  
Region Functions và Firestore: **`australia-southeast1` (Sydney)**  
Trạng thái phát hành: **đang chờ hoàn tất cloud acceptance; không phải production-ready**

Biên bản này là nguồn trạng thái hiện hành. `docs/firebase-setup.md` chỉ là snapshot hạ tầng trước khi có code.

## 1. Phạm vi đã triển khai

Frontend là React/Vite/TypeScript/Tailwind với bốn route `/`, `/chat`, `/help`, `/safe`. Production build dùng Firebase Web SDK cho Anonymous Auth, App Check reCAPTCHA Enterprise và callable Functions; frontend không import `firebase-admin`, OpenAI SDK hoặc Firestore client.

Backend `functions/` dùng TypeScript, Firebase Functions 2nd gen, Firebase Admin, OpenAI SDK chính thức và Zod. Public surface chỉ có đúng bốn callable:

1. `startConversation({ requestId, accessCode? })`
2. `getConversation({ conversationId })`
3. `sendMessage({ conversationId, message, userMessageId, attemptId, contextVersion })`
4. `clearConversation({ conversationId })`

UID chủ sở hữu luôn lấy từ Firebase Auth. Client không thể gửi `ownerUid`, system role, full history, model, domain list hoặc source ledger vì request schema là strict. Firestore Rules từ chối mọi client read/write; Admin SDK chỉ chạy sau exact-project/runtime gate.

Normal cloud messages vẫn dùng fake provider và trả `mode: "mock"`. Mọi nội dung giả lập đều ghi rõ không phải AI, không tra web và không phải tư vấn pháp lý.

## 2. Cấu trúc và file quan trọng

| Khu vực | File |
|---|---|
| Hợp đồng dùng chung | `shared/contracts.ts` |
| UI và client adapter | `src/App.tsx`, `src/lib/chat-client.ts`, `src/lib/firebase-client.ts`, `src/lib/mock-chat-client.ts` |
| Callable entry point | `functions/src/index.ts` |
| Project/runtime/Auth gate | `functions/src/security/runtime.ts` |
| Access code và quota | `functions/src/security/access-code.ts`, `functions/src/security/demo-policy.ts` |
| Phiên Firestore + fencing | `functions/src/session/firestore-repository.ts`, `functions/src/session/mock-service.ts` |
| OpenAI spike | `functions/src/ai/openai-spike.ts`, `functions/src/ai/spike-repository.ts` |
| Hosting/Rules/indexes | `firebase.json`, `firestore.rules`, `firestore.indexes.json` |
| Build/test tooling | `scripts/build-functions.mjs`, `scripts/check-bundle.mjs`, `scripts/run-emulators.mjs` |

Functions được bundle thành một `functions/lib/index.cjs`; bundle check nạp module không cần secret và xác nhận đúng bốn export. `.env` thực, `.secret.local`, service-account files, logs, Firebase cache, dependency/build output và portable test JDK đều bị Git ignore.

## 3. Cấu hình cloud đã đọc/kiểm chứng

| Thành phần | Kết quả |
|---|---|
| Firebase project | ACTIVE, project number `1055167393645` |
| Billing | Blaze đã liên kết bởi chủ tài khoản |
| Web App | ACTIVE, tên `Know Your Rights Web` |
| Hosting site | `know-your-rights-cd8b5` |
| Anonymous Auth | Enabled |
| Firestore | `(default)`, Native/Standard, Sydney, delete protection ON |
| Firestore Rules | deny-all client rules khớp source local |
| TTL/index overrides | TTL cho `conversations`, `demoGrants`, `usageBuckets`; 9 field overrides hoàn tất |
| App Check | Web App đã Registered với reCAPTCHA Enterprise, TTL 1 giờ |
| App Check domains | chỉ hai domain Firebase Hosting của project; không allow-all |
| Secrets | metadata cho `OPENAI_API_KEY` và `DEMO_ACCESS_CODE` tồn tại; không đọc value |
| Backend APIs | Functions, Run, Build, Artifact Registry, Firestore, Auth, Secret Manager, App Check và các API đã kiểm tra đều enabled |

Public reCAPTCHA site key được đọc từ App Check Console và đặt trong file production-local bị ignore. Đây là public identifier, không phải secret hoặc cơ chế authorization. Production bundle chứa Firebase public config nhưng không chứa `OPENAI_API_KEY`, `DEMO_ACCESS_CODE` hoặc emulator access fixture.

Document `runtime/demo` đã được tạo và đọc lại trong Firestore với strict shape:

```text
enabled=true
syntheticOnly=true
maxStartsPerUidPerHour=20
maxSendsPerUidPerHour=60
maxFailedStartsPerUidPerHour=5
maxFailedStartsGlobalPerHour=100
maxStartsGlobalPerHour=50
maxSendsGlobalPerHour=200
```

Thiếu/sai field, sai project/mode, dùng emulator env trên cloud hoặc tắt `enabled` đều fail closed. Owner vẫn có đường xóa phiên khi grant hết hạn hoặc demo bị tắt.

## 4. Kết quả mốc 1

| Kiểm tra thực tế | Trạng thái | Bằng chứng |
|---|---|---|
| Typecheck frontend/Node/Functions | PASS | `npm run check` |
| ESLint, zero warnings | PASS | `npm run check` |
| Unit/UI tests | PASS | 7 files, 44 tests |
| Production frontend build | PASS | Vite, Firebase adapter chunk được tạo |
| Functions build | PASS | Node 22 bundle |
| Bundle boundary | PASS | bundled contracts; 4 callable; module load không đọc secret |
| Auth/Firestore/Functions emulator integration | PASS | 2 files, 7 tests |
| Home → Chat → labelled mock answer | PASS | browser acceptance với tình huống hư cấu |
| Refresh `/chat` và SPA route | PASS | route tải lại đúng; mock memory loss được báo trung thực |
| Runtime dependency audit | PASS | root `npm audit --omit=dev`: 0; Functions `npm audit`: 0 |
| Toàn bộ dev dependency audit | RISK | 10 moderate advisory trong dependency tree của `firebase-tools`; fix đề xuất downgrade phá vỡ nên không tự áp dụng |

Emulator chỉ chạy project `demo-*`, loopback và portable Java 21 đã xác minh checksum. App Check được tắt riêng trong trusted emulator; log `app: MISSING` ở emulator là dự kiến và không áp dụng lên cloud.

## 5. OpenAI/FWO compatibility spike

Chi tiết đầy đủ ở `docs/openai-spike-m2.md`. Exact sentinel là `RUN_M2_FWO_COMPATIBILITY_SPIKE_V1` và chỉ hoạt động trong cloud-mock sau Auth, App Check, grant, quota và message fencing.

- Request 1: Structured Output planner qua `responses.parse` + `zodTextFormat`.
- Request 2: một `web_search`, `external_web_access: true`, `allowed_domains: ["www.fairwork.gov.au"]`, `tool_choice: "required"`, `max_tool_calls: 1`, `parallel_tool_calls: false`.
- Model pin: `gpt-5.4-mini-2026-03-17`; không fallback/nâng model.
- SDK và từng request đều `maxRetries: 0`.
- Firestore singleton ledger `openaiSpikeRuns/m2-fwo-v1` có tối đa hai slot bất biến, reserve trước network call.
- Chỉ lưu schema/usage/latency/failure code và raw text block gắn native citations; mọi URL được post-filter thành exact HTTPS FWO host.
- Không hiển thị nội dung pháp lý từ spike; chat chỉ nhận technical PASS/FAIL/NOT RUN có nhãn non-legal/mock.

Network-free spike tests: **PASS, 6/6**. Trạng thái paid calls sẽ được cập nhật sau cloud acceptance; không suy PASS từ mock.

## 6. Kết quả mốc 2

| Kiểm tra cloud | Trạng thái hiện tại |
|---|---|
| Deploy Hosting + 4 callable với `--project know-your-rights-cd8b5` | PENDING |
| URL Hosting thật và direct refresh `/chat` | PENDING |
| Anonymous Auth + App Check token được callable chấp nhận | PENDING |
| Access code sai bị từ chối; grant hợp lệ hoạt động | PENDING |
| Callable đúng project/region | PENDING |
| Firestore conversation owner khớp Auth UID | PENDING |
| Browser context thứ hai bị cô lập | PENDING |
| Owner clear xóa phiên | PENDING |
| Structured planner OpenAI request | NOT RUN |
| FWO-only web search OpenAI request | NOT RUN |

CLI session cũ đã được đăng xuất để xoay vòng credential trước deploy. Re-login hiện yêu cầu chủ tài khoản xác minh Google trên thiết bị đã đăng ký. Không deploy bằng phiên cũ và không bypass bước xác minh.

## 7. Rủi ro còn mở

- Đây là synthetic cloud mock và compatibility spike, chưa phải web-grounded chatbot đầy đủ trong blueprint.
- Chưa có legal/domain review, red-team đa ngôn ngữ, load test, SLO/alerting, backup/PITR hoặc quy trình incident/DSAR production.
- `maxInstances`, App Check và quota ứng dụng giảm rủi ro nhưng không phải hard spending cap; budget alert cần chủ tài khoản vận hành.
- TTL xóa bất đồng bộ và không phải cơ chế authorization hay lời hứa xóa ngay.
- Anonymous Auth cho demo không thay thế account lifecycle/consent phù hợp production.
- Security headers hiện không có CSP do reCAPTCHA/App Check cần thiết kế và kiểm thử allowlist trước khi bật.
- Không có GitHub auto-deploy, commit hoặc push trong mốc này.

