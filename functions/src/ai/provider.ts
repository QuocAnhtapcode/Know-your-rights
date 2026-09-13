import type { ConversationView } from '../../../shared/contracts';

export interface ReplyProvider {
  reply(conversation: ConversationView): Promise<string>;
}

/** Synthetic fixture only. No legal information, citations, web search or network. */
export class FakeReplyProvider implements ReplyProvider {
  reply(conversation: ConversationView): Promise<string> {
    const turn = conversation.messages.filter((message) => message.role === 'user').length;
    return Promise.resolve(
      `[MOCK — không gọi AI / không tra web] Đã nhận lượt ${turn} trong phiên thử nghiệm. `
      + 'Đây chỉ là phản hồi giả lập để kiểm tra giao diện và hợp đồng dữ liệu, không phải thông tin pháp lý. '
      + 'Bạn có thể gửi thêm một tình huống hư cấu hoặc mở Trợ giúp.',
    );
  }
}
