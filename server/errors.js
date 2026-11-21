export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function assert(condition, status, code, message) {
  if (!condition) throw new ApiError(status, code, message);
}

// Never return arbitrary upstream error messages: they can contain request URLs/keys.
export function safeError(error) {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message };
  if (error?.code && /^(BAIDU_|MAP_|LLM_|DEEPSEEK_|NO_|INVALID_|PLAN_)/.test(error.code)) {
    return { status: Number(error.status) >= 400 && Number(error.status) <= 599 ? Number(error.status) : 502,
      code: String(error.code), message: '外部服务暂不可用，请检查服务权限、余额和输入条件。' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: '请求暂时无法完成，请稍后重试。' };
}
