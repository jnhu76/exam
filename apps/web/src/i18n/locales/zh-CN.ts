/**
 * zh-CN translation catalog (the only supported locale in Phase 2).
 *
 * Keys are organized by domain. Status labels mirror `statusMeta` /
 * `constants` 1:1 so the UI layer can render them via `t()` while the
 * status *enum* and *tone/icon* metadata stay in `statusMeta.ts` (which now
 * stores `labelKey` instead of a hardcoded Chinese string).
 *
 * Keep keys stable and grouped; do NOT delete a key without grepping usages.
 */

const zhCN = {
  status: {
    exam: {
      draft: "草稿",
      published: "已发布",
      open: "开放中",
      closed: "已关闭",
      archived: "已归档",
    },
    enrollment: {
      assigned: "已分配",
      started: "已开始",
      completed: "已完成",
      blocked: "已阻止",
      not_started: "未开始",
    },
    attempt: {
      queued: "排队中",
      in_progress: "答题中",
      disrupted: "断线",
      submitted: "已交卷",
      grading: "批改中",
      graded: "已出分",
      voided: "已作废",
    },
    save: {
      saving: "保存中",
      saved: "已保存",
      failed: "保存失败",
    },
    lifecycle: {
      canceled: "已取消",
      expired: "已过期",
      stale: "过期数据",
    },
    connection: {
      connected: "连接正常",
      degraded: "连接不稳定",
      offline: "连接已断开",
    },
    health: {
      ok: "正常",
      critical: "严重",
      unknown: "未知",
    },
    result: {
      passed: "及格",
      not_passed: "不及格",
    },
    grading: {
      auto_graded: "自动评分",
      pending_manual: "待手动评分",
      fully_graded: "已完成评分",
    },
    misconduct: {
      misconduct_warning: "违规-警告",
      misconduct_serious: "违规-严重",
    },
    fallback: {
      unknown: "未知",
    },
  },

  /**
   * Candidate exam-list availability labels (CandidateExamSummary).
   * Distinct from the attempt/exam/enrollment status grammar above — these
   * are the candidate-facing availability buckets shown on the exam list.
   */
  availability: {
    available: "可参加",
    in_progress: "进行中",
    resumable: "可恢复",
    submitted_pending_grade: "待评分",
    graded: "已评分",
    max_attempts_exhausted: "次数已用完",
    not_started_yet: "未开放",
    expired: "已过期",
    unavailable: "不可用",
  },

  questionType: {
    single_choice: "单选",
    multiple_choice: "多选",
    fill_blank: "填空",
    true_false: "判断",
  },

  /**
   * Global error / toast / notify messages. API error *codes* stay machine
   * semantic (contracts/messageRegistry); these are the generic UI-facing
   * fallbacks and common mutation success/failure toasts.
   */
  errors: {
    network: "网络连接失败，请稍后重试",
    unauthorized: "登录已过期，请重新登录",
    forbidden: "没有权限执行此操作",
    notFound: "资源不存在或已被删除",
    validation: "输入内容有误，请检查后重试",
    unknown: "操作失败，请稍后重试",
    operationFailed: "操作失败，请重试",
  },

  toast: {
    saved: "已保存",
    saveFailed: "保存失败",
    submitted: "已提交",
    submitFailed: "提交失败",
    deleted: "已删除",
    deleteFailed: "删除失败",
    updated: "已更新",
    updateFailed: "更新失败",
    created: "已创建",
    createFailed: "创建失败",
  },

  common: {
    retry: "重试",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    save: "保存",
    submit: "提交",
    loading: "加载中…",
    empty: "暂无数据",
  },
} as const;

export default zhCN;
