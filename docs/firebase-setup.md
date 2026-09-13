# Firebase setup — Know Your Rights

Ngày kiểm tra: **12/09/2026**. Project duy nhất trong phạm vi: **`know-your-rights-cd8b5`**.

> **Historical snapshot.** Tài liệu này ghi lại trạng thái hạ tầng trước khi code mốc 1 được tạo. Các câu “chưa có code”, “chưa có secret” và “App Check chưa đăng ký” bên dưới mô tả đúng thời điểm 12/09/2026 nhưng không còn là trạng thái hiện hành. Xem `README.md`, `docs/openai-spike-m2.md` và `docs/milestone-1-2.md` để biết kết quả build/deploy/acceptance mới nhất. Không dùng snapshot này để kết luận hệ thống hiện đang online hay production-ready.

Đây là biên bản cấu hình hạ tầng theo `docs/blueprint.md` v4, **không phải thông báo chatbot đã online hoặc production-ready**. Chưa có mã React hay callable Functions trong repo. Chưa deploy Hosting/Functions, chưa gọi OpenAI.

## 1. Những gì đã có và đã làm

| Thành phần | Trạng thái được kiểm chứng |
|---|---|
| Billing | Blaze đã được chủ tài khoản bật; đã xác minh trong Firebase Console |
| Authentication | Anonymous đã Enabled; giữ nguyên cấu hình của người dùng |
| Auth domains | Đã có `know-your-rights-cd8b5.web.app`, `know-your-rights-cd8b5.firebaseapp.com`; localhost cũng có sẵn, không thay đổi |
| Web App | Đã tạo `Know Your Rights Web`, App ID `1:1055167393645:web:f9ff6214c98d7e7271f464` |
| Project number | `1055167393645` |
| Firestore | Đã tạo `(default)`, Standard / Native, `australia-southeast1` (Sydney) |
| Database protection | Bật delete protection; PITR tắt; không tạo lịch backup trả phí |
| Firestore Rules | Đã compile và deploy Rules từ chối toàn bộ client read/write, kể cả client đã đăng nhập |
| TTL | Đã deploy cấu hình `expiresAt` cho `conversations`, `demoGrants`, `usageBuckets`; cấu hình cloud trả `ttl: true`; tác vụ nền đã SUCCESSFUL |
| Index exemptions | Đã áp dụng bỏ indexing các trường context lớn và TTL; toàn bộ tác vụ nền đã SUCCESSFUL |
| Hosting site | Dùng site mặc định có sẵn `know-your-rights-cd8b5`, không tạo site thứ hai |
| Cloud Functions API | Đã bật; xác minh Console Enabled và CLI liệt kê functions thành công, danh sách rỗng |
| Cloud Run / Cloud Build / Artifact Registry APIs | Đã bật và xác minh từng API có Status Enabled sau xác nhận của chủ tài khoản |
| Secret Manager | Metadata API truy cập được; hai tên secret cần dùng hiện trả 404/not found; không đọc giá trị secret |
| App Check | Chưa đăng ký provider/site key, chưa kiểm thử token |

Region Firestore đã được chọn khi tạo database; không thể đổi region của database này tại chỗ. Sydney không có nghĩa mọi dữ liệu của Auth/CDN/OpenAI đều ở Australia. [Firestore locations](https://firebase.google.com/docs/firestore/locations)

Không bật thêm Cloud Storage bucket, App Hosting, SQL Connect, Extensions, Identity Platform upgrade hoặc Analytics SDK. Firebase SDK config gốc có `measurementId`/`storageBucket`; sự có mặt của các trường đó không được coi là chỉ thị phải tích hợp các dịch vụ này. File Vite chỉ giữ các trường cần thiết.

## 2. File trong repo

| File | Mục đích |
|---|---|
| `.firebaserc` | Liên kết project chính xác; khi deploy vẫn ghi rõ `--project` |
| `firebase.json` | Firestore rules/indexes, Hosting `dist`, SPA rewrite, security headers, cổng emulator loopback |
| `firestore.rules` | Server-only: deny mọi mobile/web client; không mở test mode |
| `firestore.indexes.json` | TTL và miễn indexing các trường context lớn |
| `.env.example` | Mẫu cấu hình public, không chứa secret |
| `.env.local` | Public config thực lấy từ Firebase Web App; đã được Git ignore |
| `.gitignore` | Bỏ qua env thực, secret cục bộ, service-account key theo tên thường gặp, build và logs |
| `docs/firebase-setup.md` | Biên bản này và hướng dẫn hoàn tất |

`docs/blueprint.md` không bị sửa. Chưa stage, commit, push hay đổi branch/remote/visibility. Git ignore chỉ là một lớp phòng ngừa, không bảo đảm mọi cách đặt tên secret đều được chặn.

Hosting đã cấu hình local để phục vụ Vite `dist/` và rewrite các route sang `/index.html`; chưa có `dist/index.html` nên chưa deploy. Không có `/api` rewrite, Next.js backend hoặc Firebase App Hosting. [Hosting configuration](https://firebase.google.com/docs/hosting/full-config)

## 3. Hai bước chủ tài khoản cần hoàn tất

### 3.1. Đăng ký App Check cho Web App

Thực hiện trong đúng project **`know-your-rights-cd8b5`**:

1. Mở Google Cloud Console, tìm **reCAPTCHA / Fraud Defense**. Bật reCAPTCHA Enterprise API nếu console yêu cầu, kiểm tra điều khoản và billing hiện trên màn hình.
2. Tạo key loại **Web**, **score-based**; không chọn “Use checkbox challenge”. Đặt tên dễ nhận biết, ví dụ `Know Your Rights Firebase Hosting`.
3. Domain của key chỉ gồm:
   - `know-your-rights-cd8b5.web.app`
   - `know-your-rights-cd8b5.firebaseapp.com`
4. Không thêm `localhost` hoặc wildcard rộng vào key dùng cho bản cloud. Local development dùng cấu hình test riêng; không đưa debug token vào bundle hoặc Git.
5. Mở [Firebase App Check của project](https://console.firebase.google.com/project/know-your-rights-cd8b5/appcheck), chọn **Get started → Apps → Know Your Rights Web → Register** và provider **reCAPTCHA Enterprise**. Giao diện có thể dùng tên nút hơi khác.
6. Điền site key vừa tạo. Giữ TTL token mặc định 1 giờ nếu console không có yêu cầu khác. Lưu đăng ký.
7. Đặt **public site key** vào `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` trong `.env.local`. Đây không phải OpenAI key, demo access code hoặc App Check debug token.

Đăng ký provider **không tự bảo vệ callable**. Khi viết ứng dụng phải khởi tạo `ReCaptchaEnterpriseProvider`, auto refresh token, và đặt `enforceAppCheck: true` trong callable gen2. Phải thử trên URL Hosting trước khi công bố live. Chưa bật enforcement hàng loạt cho các sản phẩm chưa tích hợp.

Nguồn: [App Check Web](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider), [Callable enforcement](https://firebase.google.com/docs/app-check/cloud-functions).

### 3.2. Nhập hai secret trực tiếp, không qua chat

Bạn tự mở terminal tại repo và chạy từng lệnh dưới đây. Nhập giá trị khi Firebase CLI hỏi; không viết giá trị thật vào dòng lệnh, file Markdown, `.env.local` hoặc GitHub.

```powershell
firebase functions:secrets:set OPENAI_API_KEY --project know-your-rights-cd8b5
firebase functions:secrets:set DEMO_ACCESS_CODE --project know-your-rights-cd8b5
```

- `OPENAI_API_KEY`: key của OpenAI project bạn dùng để demo. Không nhập Firebase public API key vào đây.
- `DEMO_ACCESS_CODE`: mã riêng, khó đoán, chỉ chia sẻ cho người tham gia demo qua kênh riêng.
- Không gửi hai giá trị này cho trợ lý. Chỉ báo đã hoàn thành.
- Không tạo dummy secret rồi coi là đã sẵn sàng live.
- Có thể kiểm tra bằng lệnh `functions:secrets:get` để xem **metadata**; không dùng `functions:secrets:access`.
- Khi triển khai, bind OpenAI secret chỉ vào `sendMessage`; bind demo access code vào `startConversation`. Đổi secret cần redeploy function tiêu thụ nó.
- Chưa có service-account JSON được tạo/tải về; runtime sử dụng identity do Google quản lý và IAM tối thiểu.

Nguồn: [Firebase Functions secrets](https://firebase.google.com/docs/functions/config-env).

Việc nhập secret **không đồng nghĩa đã cho phép smoke test OpenAI trả phí**. Cần xác nhận riêng trước lần gọi thật đầu tiên.

## 4. Hợp đồng cần giữ khi bắt đầu code

- React/Vite/TypeScript/Tailwind; Firebase Web SDK chỉ dùng App/Auth/App Check/Functions theo luồng MVP.
- Auth dùng `browserSessionPersistence`. Browser không đọc/ghi Firestore trực tiếp, không lưu transcript vào localStorage/IndexedDB.
- Callable gen2 TypeScript/Node 22: `startConversation`, `getConversation`, `sendMessage`, `clearConversation`; region luôn `australia-southeast1` ở cả server và client.
- Chỉ thêm cấu hình `functions` vào `firebase.json` khi đã có thư mục/source/package hợp lệ. Hiện cấu hình emulator Functions là cổng dự kiến, chưa có Functions để chạy.
- Admin SDK bỏ qua Firestore Rules: function bắt buộc kiểm tra UID/owner, grant, expiry, quota và input. Rules đã deploy không thay thế các kiểm tra này.
- Mặc định fail closed nếu runtime config còn thiếu/không hợp lệ. `runtime/demo` và quota app chưa được tạo; không bật AI theo mặc định.
- `expiresAt` phải là Firestore Timestamp, do server tạo. TTL không tự đặt thời hạn 30 phút cho document; code phải làm việc đó.
- `conversations.expiresAt` quản lý dọn phiên; expiry của metadata `demoGrants`/`usageBuckets` phải giữ đủ cửa sổ quota, không dùng việc xóa chat để reset ngân sách.
- Các document phiên không có transcript subcollections trong MVP. Chủ sở hữu có đường xóa chủ động; late response không được tái tạo dữ liệu.
- Tắt indexing các trường context không dùng làm query. Nếu thêm query sau này, review lại indexes và deploy thay đổi tương ứng.
- `minInstances: 0`, giới hạn instances/concurrency/tokens/requests được đặt khi có code. Hiện chưa có function nào nên chưa cấu hình các giới hạn runtime này.
- Domain nguồn và prompt/model là cấu hình server; chưa đánh dấu model hoặc web search có quyền sử dụng trước smoke test.

TTL xử lý bất đồng bộ, thường dọn trong vòng khoảng 24 giờ sau expiry và có phí delete. Không phải cơ chế chặn truy cập hay lời hứa xóa ngay. Việc deploy TTL thành công cũng không chứng minh đã kiểm thử xóa vật lý. [Firestore TTL](https://firebase.google.com/docs/firestore/ttl), [Index/TTL configuration](https://firebase.google.com/docs/reference/firestore/indexes)

## 5. Kết quả chạy thật

| Kiểm tra | Kết quả | Phạm vi bằng chứng |
|---|---|---|
| Đúng project, Web App và database | PASS | CLI tạo/list/get và cấu hình thực của project |
| Anonymous Enabled; hai Hosting domains có trong Auth | PASS | Firebase Console, không sửa provider của người dùng |
| Compile/deploy Firestore Rules | PASS | Firebase CLI báo compile và released rules thành công |
| Read Firestore không đăng nhập | PASS | GET tới document synthetic `conversations/setup_probe` trả HTTP 403; không tạo document |
| Deploy TTL/index exemptions | PASS | CLI deploy thành công, đọc lại thấy đủ cấu hình |
| TTL/index tác vụ nền hoàn tất | PASS | Đọc lại operations: cả 9 tác vụ có state SUCCESSFUL |
| Xóa vật lý theo TTL | NOT RUN | Chưa tạo document để thử; không suy từ `ttl: true` |
| Bốn API backend được bật | PASS | Cloud Console xác nhận Enabled từng API |
| Liệt kê Functions | PASS | Sau khi các API được bật, CLI trả success với danh sách rỗng |
| JSON config hợp lệ | PASS | Parse `firebase.json`, `.firebaserc`, `firestore.indexes.json` bằng Node |
| Env/secret/debug log được Git ignore | PASS | `git check-ignore` cho `.env.local`, `.secret.local`, `functions/.secret.local`, `firebase-debug.log` |
| App Check/token/enforcement | NOT RUN | Chưa đăng ký key hoặc triển khai ứng dụng |
| Authenticated client bị Rules chặn | NOT RUN | Không tạo tài khoản thử ở mốc hạ tầng này |
| Build/emulator/callable end-to-end | NOT RUN | Chưa có mã ứng dụng/dependencies |
| Hosting app/cloud acceptance | NOT RUN | URL gốc hiện trả HTTP 404; chỉ có site, chưa có bản phát hành |
| OpenAI/model/web search | NOT RUN | Không đọc key, không gọi API trả phí |

Lỗi từng gặp: `functions:list` ban đầu thất bại khi API chưa sẵn sàng. Sau khi bật Cloud Functions và các API phụ thuộc, cùng phép kiểm tra đã thành công. Không còn lỗi liệt kê Functions ở lần cuối; điều đó chưa kiểm chứng quyền deploy/build/runtime.

## 6. Cách kiểm tra lại và bước tiếp theo

Các lệnh dưới đây chỉ đọc metadata/cấu hình, không đọc secret payload:

```powershell
firebase apps:list WEB --project know-your-rights-cd8b5
firebase firestore:databases:get "(default)" --project know-your-rights-cd8b5
firebase firestore:indexes --project know-your-rights-cd8b5
firebase firestore:operations:list --project know-your-rights-cd8b5
firebase hosting:sites:list --project know-your-rights-cd8b5
firebase functions:list --project know-your-rights-cd8b5
```

Sau khi App Check và secrets sẵn sàng: scaffold code, chạy test synthetic, deploy vertical slice vào đúng project/site khi được phép, rồi kiểm tra toàn bộ luồng trên URL Hosting. Không dùng localhost hoặc mock làm bằng chứng cloud acceptance.

Địa chỉ site đã được Firebase cấp: [know-your-rights-cd8b5.web.app](https://know-your-rights-cd8b5.web.app). **Chưa có website ở địa chỉ này trong mốc setup hiện tại.**

Chủ tài khoản còn cần chốt ngân sách demo, người theo dõi usage và thời điểm tắt demo. Chưa cấu hình budget alert/spend cap; không coi Blaze, App Check hay `maxInstances` là hard spending cap. Hạ tầng đã tạo có thể phát sinh chi phí khi dùng; không có cam kết miễn phí.
