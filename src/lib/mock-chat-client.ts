import {
  callableContracts,
  MAX_MESSAGES,
  type ChatClient,
  type ConversationView,
  type SendMessageResponse,
} from '../../shared/contracts';

/** Synthetic fixtures only. No legal answers, Firebase, persistence or network. */
export function createMockChatClient(): ChatClient {
  const conversations = new Map<string, ConversationView>();
  const starts = new Map<string, string>();
  const attempts = new Map<string, { input: string; response: SendMessageResponse }>();
  let activeConversationId: string | null = null;

  function get(id: string) {
    const conversation = conversations.get(id);
    if (!conversation || Date.parse(conversation.expiresAt) <= Date.now()) {
      throw new Error('Phiên mock đã kết thúc hoặc bị mất khi tải lại trang. Hãy bắt đầu cuộc trò chuyện mới.');
    }
    return conversation;
  }

  function deleteConversation(id: string) {
    conversations.delete(id);
    for (const key of attempts.keys()) if (key.startsWith(`${id}:`)) attempts.delete(key);
    if (activeConversationId === id) activeConversationId = null;
  }

  return {
    async startConversation(input) {
      const request = callableContracts.startConversation.request.parse(input);
      const previousId = starts.get(request.requestId);
      if (previousId) {
        return callableContracts.startConversation.response.parse({ mode: 'mock', conversation: get(previousId) });
      }
      if (activeConversationId) {
        const active = get(activeConversationId);
        if (!request.replaceConversationId) {
          throw new Error('Hãy xác nhận thay phiên hiện tại trước khi bắt đầu phiên mới.');
        }
        if (request.replaceConversationId !== active.conversationId) {
          throw new Error('Phiên cần thay không khớp với phiên đang mở.');
        }
        deleteConversation(active.conversationId);
      } else if (request.replaceConversationId) {
        throw new Error('Phiên cần thay không còn tồn tại.');
      }
      const conversation: ConversationView = {
        conversationId: crypto.randomUUID(), contextVersion: 0, status: 'active',
        messages: [], userFacts: [], evidenceLedger: [],
        conversationState: { language: 'vi', currentTopic: null, pendingQuestion: null },
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      conversations.set(conversation.conversationId, conversation);
      activeConversationId = conversation.conversationId;
      starts.set(request.requestId, conversation.conversationId);
      return callableContracts.startConversation.response.parse({ mode: 'mock', conversation });
    },
    async getConversation(input) {
      const request = callableContracts.getConversation.request.parse(input);
      return callableContracts.getConversation.response.parse({ mode: 'mock', conversation: get(request.conversationId) });
    },
    async sendMessage(input) {
      const request = callableContracts.sendMessage.request.parse(input);
      const conversation = get(request.conversationId);
      const attemptKey = `${request.conversationId}:${request.attemptId}`;
      const prior = attempts.get(attemptKey);
      if (prior) {
        if (prior.input !== JSON.stringify(request)) throw new Error('Attempt ID đã được dùng cho một yêu cầu khác.');
        return callableContracts.sendMessage.response.parse(prior.response);
      }
      if (conversation.contextVersion !== request.contextVersion) throw new Error('Ngữ cảnh đã thay đổi. Hãy tải lại phiên trước khi gửi.');
      if (conversation.messages.some((message) => message.id === request.userMessageId)) {
        throw new Error('Tin nhắn này đã được gửi. Không tạo lượt gửi trùng.');
      }
      if (conversation.messages.length + 2 > MAX_MESSAGES) throw new Error('Phiên thử đã đủ 40 tin nhắn. Hãy bắt đầu phiên mới.');
      const turn = conversation.messages.filter((message) => message.role === 'user').length + 1;
      const answer = turn === 1
        ? 'Mình đã nhận được câu hỏi của bạn. Đây là câu trả lời mẫu để thử giao diện — mình chưa gọi AI hay tra cứu web.\n\nBạn có thể kể tiếp, thử gửi một câu hỏi khác hoặc mở bảng nguồn bên cạnh. Đừng nhập tên thật, số visa hay thông tin nhạy cảm trong bản thử.'
        : `Mình đã nhận lượt trao đổi thứ ${turn} trong phiên thử này. Các tin nhắn trước vẫn ở trên để bạn kiểm tra luồng hội thoại.\n\nPhản hồi này được tạo bằng mock cố định, không phân tích tình huống và không đưa ra kết luận về quyền lao động.`;
      const now = new Date().toISOString();
      conversation.messages.push(
        { id: request.userMessageId, role: 'user', text: request.message, createdAt: now, sourceIds: [], provenance: 'user_reported' },
        { id: crypto.randomUUID(), role: 'assistant', text: answer, createdAt: now, sourceIds: [], provenance: 'mock' },
      );
      conversation.contextVersion += 1;
      conversation.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      const response = callableContracts.sendMessage.response.parse({ mode: 'mock', status: 'completed', attemptId: request.attemptId, conversation });
      attempts.set(attemptKey, { input: JSON.stringify(request), response });
      return response;
    },
    async clearConversation(input) {
      const request = callableContracts.clearConversation.request.parse(input);
      deleteConversation(request.conversationId);
      return callableContracts.clearConversation.response.parse({ mode: 'mock', conversationId: request.conversationId, cleared: true });
    },
  };
}
